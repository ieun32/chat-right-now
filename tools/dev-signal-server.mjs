/**
 * Zero-config local signaling server for development (`npm run signal`).
 *
 * Mirrors exactly what the Supabase backend gives us: a per-room roster
 * (presence) and targeted relay of WebRTC handshake payloads. It keeps NO chat
 * or position data — those never leave the peer mesh.
 *
 * Protocol (JSON over WS), matching src/net/signaling.js (LocalSignaling):
 *   client -> { t:'join', room, meta }
 *          -> { t:'signal', room, from, to, data }
 *          -> { t:'presence', room, meta }
 *          -> { t:'bye', room, peerId }
 *   server -> { t:'peers', peers:[meta...] }        (broadcast on any roster change)
 *          -> { t:'signal', from, to, data }         (delivered only to `to`)
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);
const rooms = new Map(); // room -> Map<peerId, { ws, meta }>

const wss = new WebSocketServer({ port: PORT });
console.log(`[signal] listening on ws://localhost:${PORT}`);

function roster(room) {
  return [...(rooms.get(room)?.values() || [])].map((m) => m.meta);
}

function broadcastPeers(room) {
  const members = rooms.get(room);
  if (!members) return;
  const msg = JSON.stringify({ t: 'peers', peers: roster(room) });
  for (const { ws } of members.values()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.meta = null;
  ws.room = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      ws.room = m.room;
      ws.meta = m.meta;
      if (!rooms.has(m.room)) rooms.set(m.room, new Map());
      rooms.get(m.room).set(m.meta.peerId, { ws, meta: m.meta });
      broadcastPeers(m.room);
      return;
    }

    if (m.t === 'presence' && ws.room) {
      const members = rooms.get(ws.room);
      if (members && members.has(m.meta.peerId)) {
        members.get(m.meta.peerId).meta = m.meta;
        ws.meta = m.meta;
        broadcastPeers(ws.room);
      }
      return;
    }

    if (m.t === 'signal') {
      const dest = rooms.get(m.room)?.get(m.to);
      if (dest && dest.ws.readyState === dest.ws.OPEN) {
        dest.ws.send(JSON.stringify({ t: 'signal', from: m.from, to: m.to, data: m.data }));
      }
      return;
    }

    if (m.t === 'bye') leave(ws);
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

function leave(ws) {
  if (!ws.room) return;
  const members = rooms.get(ws.room);
  const peerId = ws.meta?.peerId;
  if (members && peerId) {
    members.delete(peerId);
    if (members.size === 0) rooms.delete(ws.room);
    else broadcastPeers(ws.room);
  }
  ws.room = null;
  ws.meta = null;
}
