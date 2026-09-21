/**
 * Signaling adapter — the ONLY server-touching part of the app.
 *
 * Its whole job: tell each client "who else is in this room right now" (presence)
 * and relay tiny WebRTC handshake payloads (SDP offer/answer + ICE candidates)
 * between two specific peers. Once the mesh DataChannels are up, no chat or
 * movement traffic ever touches the signaling layer.
 *
 * Two interchangeable backends implement the same interface so you can develop
 * with zero accounts (local WS) and ship serverless (Supabase Realtime), flipping
 * a single line in config.json.
 *
 * Interface (all backends):
 *   await join(room, selfMeta)   selfMeta = { peerId, publicKey, nick, animal }
 *   onPeers(cb)                  cb(metaList)   full roster (excludes self), on every change
 *   onSignal(cb)                 cb({ from, data })  a handshake payload addressed to us
 *   send(toPeerId, data)         relay a handshake payload to one peer
 *   updatePresence(patch)        publish a nick/animal change
 *   await leave()
 */

const listeners = () => ({ peers: [], signal: [] });

function emit(bag, name, arg) {
  for (const cb of bag[name]) {
    try {
      cb(arg);
    } catch (err) {
      console.error(`[signaling] ${name} listener threw`, err);
    }
  }
}

/** Local WebSocket backend — talks to tools/dev-signal-server.mjs. */
class LocalSignaling {
  constructor(url) {
    this.url = url;
    this.bag = listeners();
    this.ws = null;
    this.room = null;
    this.self = null;
    this._queue = [];
  }

  join(room, self) {
    this.room = room;
    this.self = self;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        this._raw({ t: 'join', room, meta: self });
        for (const m of this._queue) this._raw(m);
        this._queue = [];
        resolve();
      };
      ws.onerror = (e) => reject(new Error('local signaling connection failed'));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === 'peers') emit(this.bag, 'peers', m.peers.filter((p) => p.peerId !== self.peerId));
        else if (m.t === 'signal' && m.to === self.peerId) emit(this.bag, 'signal', { from: m.from, data: m.data });
      };
    });
  }

  _raw(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
    else this._queue.push(obj);
  }

  onPeers(cb) { this.bag.peers.push(cb); }
  onSignal(cb) { this.bag.signal.push(cb); }
  send(to, data) { this._raw({ t: 'signal', room: this.room, from: this.self.peerId, to, data }); }
  updatePresence(patch) {
    this.self = { ...this.self, ...patch };
    this._raw({ t: 'presence', room: this.room, meta: this.self });
  }
  async leave() {
    this._raw({ t: 'bye', room: this.room, peerId: this.self?.peerId });
    try { this.ws?.close(); } catch {}
  }
}

/** Supabase Realtime backend — Presence for the roster, Broadcast for handshakes. */
class SupabaseSignaling {
  constructor({ url, anonKey }) {
    this.url = url;
    this.anonKey = anonKey;
    this.bag = listeners();
    this.client = null;
    this.channel = null;
    this.self = null;
  }

  async join(room, self) {
    const { createClient } = await import('@supabase/supabase-js');
    this.self = self;
    this.client = createClient(this.url, this.anonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });

    const channel = this.client.channel(`crn:${room}`, {
      config: {
        presence: { key: self.peerId },
        broadcast: { self: false, ack: false },
      },
    });
    this.channel = channel;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const metas = [];
      for (const key of Object.keys(state)) {
        const entry = state[key][0];
        if (entry && entry.peerId && entry.peerId !== self.peerId) metas.push(entry);
      }
      emit(this.bag, 'peers', metas);
    });

    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload && payload.to === self.peerId) emit(this.bag, 'signal', { from: payload.from, data: payload.data });
    });

    await new Promise((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track(self);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Supabase channel ${status}`));
        }
      });
    });
  }

  onPeers(cb) { this.bag.peers.push(cb); }
  onSignal(cb) { this.bag.signal.push(cb); }
  send(to, data) {
    this.channel?.send({ type: 'broadcast', event: 'signal', payload: { from: this.self.peerId, to, data } });
  }
  updatePresence(patch) {
    this.self = { ...this.self, ...patch };
    this.channel?.track(this.self);
  }
  async leave() {
    try { await this.channel?.untrack(); } catch {}
    try { await this.client?.removeChannel(this.channel); } catch {}
  }
}

export function createSignaling(config) {
  if (config.signaling === 'supabase') {
    const s = config.supabase || {};
    if (!s.url || s.url.includes('YOUR-PROJECT') || !s.anonKey || s.anonKey.includes('YOUR-')) {
      throw new Error(
        'Supabase is selected but config.json has placeholder credentials. ' +
        'Fill supabase.url / supabase.anonKey, or set "signaling":"local" and run `npm run signal`.',
      );
    }
    return new SupabaseSignaling(s);
  }
  return new LocalSignaling((config.local && config.local.url) || 'ws://localhost:8787');
}
