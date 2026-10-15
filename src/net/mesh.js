/**
 * Full-mesh WebRTC transport.
 *
 * Every peer keeps a direct RTCDataChannel to every other peer. A message is
 * sent by encrypting it once and writing it to each open channel — there is no
 * relay and no server in the data path.
 *
 * Connection setup:
 *   - The signaling adapter hands us the current roster. For each peer we don't
 *     yet have, we open a connection. To avoid "glare" (both sides offering at
 *     once) the peer with the lexicographically smaller peerId is the initiator:
 *     it creates the DataChannel and the offer; the other side answers.
 *
 * Key agreement (crypto.js "A안"):
 *   - Each client starts with its own random room session key. On every channel
 *     open both sides exchange their key (sealed to the peer's public key). A
 *     peer adopts an incoming key only if its keyId sorts lower, and re-floods
 *     the adopted key to all peers. Because keyIds are totally ordered and we
 *     only ever move downward, everyone converges on one key in a few hops.
 */
import {
  createSessionKey, makeSession, sealSessionKey, openSessionKey,
  encryptMessage, decryptMessage, shouldAdoptKey,
} from '../shared/crypto.js';
import { MSG, MESH_EVENT } from '../shared/protocol.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class Mesh {
  /**
   * @param {object} o
   * @param {object} o.signaling  a createSignaling() instance
   * @param {object} o.identity   from createIdentity()
   * @param {object} o.self       { peerId, nick, animal, x, y }
   */
  constructor({ signaling, identity, self }) {
    this.signaling = signaling;
    this.identity = identity;
    this.self = self;
    this.session = makeSession(createSessionKey());
    this.peers = new Map(); // peerId -> { pc, dc, meta, helloSent }
    this.handlers = {};     // event -> [cb]
    this.started = false;
  }

  on(event, cb) {
    (this.handlers[event] ||= []).push(cb);
    return this;
  }

  _emit(event, arg) {
    for (const cb of this.handlers[event] || []) {
      try { cb(arg); } catch (err) { console.error(`[mesh] ${event} handler`, err); }
    }
  }

  async start(room) {
    this.signaling.onPeers((roster) => this._reconcile(roster));
    this.signaling.onSignal(({ from, data }) => this._onSignal(from, data));
    await this.signaling.join(room, {
      peerId: this.self.peerId,
      publicKey: this.identity.publicKeyB64,
      nick: this.self.nick,
      animal: this.self.animal,
      hidden: this.self.hidden === true,
    });
    this.started = true;
    // Visibility may have changed while the initial subscription was pending.
    this.signaling.updatePresence({ hidden: this.self.hidden === true });
    this._reconcileStatus();
  }

  _status(text) { this._emit(MESH_EVENT.STATUS, text); }

  _isInitiator(peerId) { return this.self.peerId < peerId; }

  /** Open connections to newly-seen peers; drop peers that vanished from presence. */
  _reconcile(roster) {
    const seen = new Set();
    for (const meta of roster) {
      seen.add(meta.peerId);
      const existing = this.peers.get(meta.peerId);
      if (existing) existing.meta = { ...existing.meta, ...meta };
      else this._createPeer(meta.peerId, meta, this._isInitiator(meta.peerId));
      this._emit(MESH_EVENT.PEER_AVAILABILITY, { id: meta.peerId, hidden: meta.hidden === true });
    }
    for (const [peerId] of this.peers) {
      if (!seen.has(peerId)) this._dropPeer(peerId, 'left room');
    }
    this._reconcileStatus();
  }

  _createPeer(peerId, meta, initiator) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { pc, dc: null, meta, helloSent: false };
    this.peers.set(peerId, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.send(peerId, { ice: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this._dropPeer(peerId, pc.connectionState);
      }
    };

    if (initiator) {
      const dc = pc.createDataChannel('mesh', { ordered: true });
      this._wireChannel(peerId, dc);
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          this.signaling.send(peerId, { sdp: pc.localDescription });
        } catch (err) { console.error('[mesh] offer', err); }
      };
    } else {
      pc.ondatachannel = (e) => this._wireChannel(peerId, e.channel);
    }
    return peer;
  }

  async _onSignal(from, data) {
    let peer = this.peers.get(from);
    if (!peer) peer = this._createPeer(from, { peerId: from }, this._isInitiator(from));
    const pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.signaling.send(from, { sdp: pc.localDescription });
        }
      } else if (data.ice) {
        await pc.addIceCandidate(data.ice).catch(() => {});
      }
    } catch (err) {
      console.error('[mesh] signal handling', err);
    }
  }

  _wireChannel(peerId, dc) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.dc = dc;
    dc.onopen = () => {
      this._sendHello(peerId);
      this._sendKey(peerId);
      this._reconcileStatus();
    };
    dc.onclose = () => this._dropPeer(peerId, 'channel closed');
    dc.onmessage = (ev) => this._onMessage(peerId, ev.data);
  }

  _reconcileStatus() {
    const connected = [...this.peers.values()].filter((p) => p.dc?.readyState === 'open');
    const hidden = connected.filter((p) => p.meta.hidden === true).length + (this.self.hidden === true ? 1 : 0);
    const online = connected.length + 1 - hidden;
    this._status(`${online}명 온라인${hidden ? ` · ${hidden}명 오프라인` : ''}`);
  }

  _rawSend(peer, obj) {
    if (peer.dc && peer.dc.readyState === 'open') {
      try { peer.dc.send(JSON.stringify(obj)); } catch (err) { console.error('[mesh] send', err); }
    }
  }

  _sendHello(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.helloSent) return;
    peer.helloSent = true;
    this._rawSend(peer, {
      t: MSG.HELLO,
      peerId: this.self.peerId,
      publicKey: this.identity.publicKeyB64,
      nick: this.self.nick,
      animal: this.self.animal,
      x: this.self.x,
      y: this.self.y,
      weapon: this.self.weapon || 'club',
      hidden: this.self.hidden === true,
    });
  }

  _sendKey(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.meta || !peer.meta.publicKey) return; // need their pubkey (from presence/HELLO)
    const sealed = sealSessionKey(this.session.key, peer.meta.publicKey, this.identity);
    this._rawSend(peer, { t: MSG.KEY, sealed });
  }

  _floodKey() {
    for (const [peerId] of this.peers) this._sendKey(peerId);
  }

  _onMessage(peerId, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (m.t === MSG.HELLO) {
      peer.meta = { ...peer.meta, peerId: m.peerId, publicKey: m.publicKey, nick: m.nick, animal: m.animal,
        hidden: (peer.meta.hidden ?? m.hidden) === true };
      // Their pubkey may only now be known — (re)send our key so agreement can proceed.
      this._sendKey(peerId);
      this._emit(MESH_EVENT.PEER_JOIN, {
        id: peerId, nick: m.nick, animal: m.animal, x: m.x, y: m.y,
        hidden: (peer.meta.hidden ?? m.hidden) === true,
        weapon: m.weapon,
      });
      this._reconcileStatus();
      return;
    }

    if (m.t === MSG.KEY) {
      if (!peer.meta || !peer.meta.publicKey) return;
      const key = openSessionKey(m.sealed, peer.meta.publicKey, this.identity);
      if (!key) return;
      const incoming = makeSession(key);
      if (shouldAdoptKey(this.session, incoming.id)) {
        this.session = incoming;
        this._floodKey(); // propagate the lower key to everyone we know
      }
      return;
    }

    if (m.t === MSG.BYE) { this._dropPeer(peerId, 'said bye'); return; }

    if (m.t === 'enc') {
      const obj = decryptMessage(m.e, this.session);
      if (!obj) return; // not our key yet, or forged — drop silently
      this._route(peerId, obj);
    }
  }

  _route(peerId, obj) {
    switch (obj.type) {
      case MSG.ATTACK:
      case MSG.STUN:
      case MSG.JUMP:
      case MSG.EQUIP:
        this._emit(MESH_EVENT.PEER_ACTION, { id: peerId, action: obj });
        break;
      case MSG.MOVE:
      case MSG.SYNC:
        this._emit(MESH_EVENT.PEER_MOVE, { id: peerId, state: obj, sync: obj.type === MSG.SYNC });
        break;
      case MSG.TOWER:
        this._emit(MESH_EVENT.PEER_TOWER, { id: peerId, state: obj });
        break;
      case MSG.CHAT:
        this._emit(MESH_EVENT.PEER_CHAT, { id: peerId, text: obj.text });
        break;
      case MSG.PROFILE: {
        const peer = this.peers.get(peerId);
        if (peer) peer.meta = { ...peer.meta, nick: obj.nick, animal: obj.animal };
        this._emit(MESH_EVENT.PEER_PROFILE, { id: peerId, nick: obj.nick, animal: obj.animal });
        break;
      }
      default: break;
    }
  }

  /** Encrypt once, write to every open channel. */
  _broadcast(obj) {
    const env = encryptMessage(obj, this.session);
    const frame = { t: 'enc', e: env };
    for (const peer of this.peers.values()) this._rawSend(peer, frame);
  }

  sendMove(state) { Object.assign(this.self, { x: state.x, y: state.y }); this._broadcast({ type: MSG.MOVE, ...state }); }
  sendSync(state) { Object.assign(this.self, { x: state.x, y: state.y }); this._broadcast({ type: MSG.SYNC, ...state }); }
  sendChat(text) { this._broadcast({ type: MSG.CHAT, text }); }
  sendAction(action) { this._broadcast(action); }
  sendTower(state) { Object.assign(this.self, { x: state.x }); this._broadcast({ type: MSG.TOWER, ...state }); }
  setHidden(hidden) {
    this.self.hidden = hidden === true;
    if (this.started) this.signaling.updatePresence({ hidden: this.self.hidden });
    this._reconcileStatus();
  }
  sendProfile({ nick, animal }) {
    this.self.nick = nick;
    this.self.animal = animal;
    this.signaling.updatePresence({ nick, animal });
    this._broadcast({ type: MSG.PROFILE, nick, animal });
  }

  _dropPeer(peerId, reason) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    try { peer.dc && peer.dc.close(); } catch {}
    try { peer.pc && peer.pc.close(); } catch {}
    this._emit(MESH_EVENT.PEER_LEAVE, { id: peerId, reason });
    this._reconcileStatus();
  }

  async stop() {
    this.started = false;
    for (const peer of this.peers.values()) {
      this._rawSend(peer, { t: MSG.BYE });
      try { peer.dc && peer.dc.close(); } catch {}
      try { peer.pc && peer.pc.close(); } catch {}
    }
    this.peers.clear();
    try { await this.signaling.leave(); } catch {}
  }
}
