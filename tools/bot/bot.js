/**
 * Headless test peer. Runs the REAL signaling + mesh stack (same code the app
 * uses) inside a hidden Electron renderer, joins a room, then wanders and chats
 * so a human client in the same room can confirm the P2P mesh end-to-end.
 */
import { createIdentity } from '../../src/shared/crypto.js';
import { createSignaling } from '../../src/net/signaling.js';
import { Mesh } from '../../src/net/mesh.js';
import { MESH_EVENT } from '../../src/shared/protocol.js';
import { makeActor, applyMove, settle, velocityFor, WORLD } from '../../src/shared/world.js';

const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'SMOKE').toUpperCase();
const nick = params.get('nick') || 'Bot';
const animal = params.get('animal') || 'dog';

const log = (...a) => console.log('[bot]', ...a);

(async function run() {
  const config = await fetch('../../config.json').then((r) => r.json());
  const identity = createIdentity();
  const peerId = `bot_${crypto.randomUUID().slice(0, 8)}`;
  const self = { peerId, nick, animal, x: 0.5, y: 0.85 };

  const me = makeActor({ id: peerId, nick, animal, x: self.x, y: self.y, isLocal: true });

  const signaling = createSignaling(config);
  const mesh = new Mesh({ signaling, identity, self });

  mesh.on(MESH_EVENT.STATUS, (t) => log('status:', t));
  mesh.on(MESH_EVENT.PEER_JOIN, (p) => log('peer join:', p.nick, p.id));
  mesh.on(MESH_EVENT.PEER_LEAVE, (p) => log('peer leave:', p.id, p.reason));
  mesh.on(MESH_EVENT.PEER_CHAT, (p) => log('peer chat:', p.id, JSON.stringify(p.text)));

  log(`joining room "${room}" as ${nick} (${animal}) ${peerId}`);
  await mesh.start(room);
  log('joined; signaling up. Waiting for peers…');

  // Wander: flip to a random direction every ~1.6s (event-based, like a human).
  const dirs = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, -1], [0, 1], [0, 0]];
  setInterval(() => {
    settle(me);
    // bounce off the walkable edges
    let [dx, dy] = dirs[(Math.random() * dirs.length) | 0];
    if (me.x < WORLD.MIN_X + 0.05) dx = 1;
    if (me.x > WORLD.MAX_X - 0.05) dx = -1;
    if (me.y < WORLD.MIN_Y + 0.05) dy = 1;
    if (me.y > WORLD.MAX_Y - 0.05) dy = -1;
    const { vx, vy } = velocityFor(dx, dy);
    applyMove(me, { x: me.x, y: me.y, vx, vy });
    mesh.sendMove({ x: me.x, y: me.y, vx, vy });
  }, 1600);

  // Anti-drift sync, same as the app.
  setInterval(() => {
    if (me.vx || me.vy) {
      settle(me);
      mesh.sendSync({ x: me.x, y: me.y, vx: me.vx, vy: me.vy });
    }
  }, WORLD.SYNC_INTERVAL_MS);

  // Chatter.
  const lines = ['안녕! 봇이야 🐶', 'mesh 연결 잘 되나?', '나 지금 움직이는 중', 'P2P 채팅 테스트', '들려?'];
  let i = 0;
  setInterval(() => {
    const text = lines[i % lines.length] + ` (#${i + 1})`;
    i++;
    mesh.sendChat(text);
    log('sent chat:', text);
  }, 4000);
})().catch((err) => log('FATAL', err && err.message ? err.message : err));
