/**
 * Renderer entry point — ties the world model, the mesh, input, and drawing
 * together, and manages the click-through overlay behaviour.
 */
import { createIdentity } from '../shared/crypto.js';
import { createSignaling } from '../net/signaling.js';
import { Mesh } from '../net/mesh.js';
import { MESH_EVENT, sanitizeNick, sanitizeText } from '../shared/protocol.js';
import {
  WORLD, makeActor, applyMove, settle, velocityFor, posAt, isMoving,
  addBubble, pruneBubbles, clampX, clampY,
} from '../shared/world.js';
import { loadSprites, animals, drawActor, drawPreview } from './render.js';

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  identity: createIdentity(),
  peerId: `p_${crypto.randomUUID().slice(0, 8)}`,
  world: new Map(),   // id -> actor
  local: null,
  mesh: null,
  selectedAnimal: 'cat',
  chatOpen: false,
  joined: false,
  keys: { left: false, right: false, up: false, down: false },
  lastDir: { dx: 0, dy: 0 },
  boxes: new Map(),   // id -> screen box (for cursor hit-testing)
  interactive: null,  // last value pushed to the main process
};

// ---------------------------------------------------------------- boot
(async function boot() {
  state.config = await fetch('./config.json').then((r) => r.json());
  await loadSprites();
  buildAnimalPicker();
  wireJoinScreen();
  // The join card must be clickable, so grab the mouse until we're in-world.
  setInteractive(true);
  window.overlay?.focus();
  requestAnimationFrame(loop);
})().catch((err) => showJoinError(err.message || String(err)));

// ---------------------------------------------------------------- join UI
function buildAnimalPicker() {
  const wrap = $('animals');
  wrap.innerHTML = '';
  for (const name of animals()) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (name === state.selectedAnimal ? ' sel' : '');
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    c.style.width = '48px'; c.style.height = '48px';
    drawPreview(c.getContext('2d'), name, 2);
    slot.appendChild(c);
    slot.onclick = () => {
      state.selectedAnimal = name;
      wrap.querySelectorAll('.slot').forEach((s) => s.classList.remove('sel'));
      slot.classList.add('sel');
    };
    wrap.appendChild(slot);
  }
}

function randomRoom() {
  const pool = animals();
  const a = pool[(Math.random() * pool.length) | 0].toUpperCase();
  return `${a}-${(10 + Math.random() * 90) | 0}`;
}

function wireJoinScreen() {
  $('room').value = randomRoom();
  $('dice').onclick = () => { $('room').value = randomRoom(); };
  $('enter').onclick = join;
  $('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('hud-quit').onclick = () => window.overlay?.quit();
}

function showJoinError(msg) {
  const el = $('join-error');
  if (el) el.textContent = msg;
}

async function join() {
  if (state.joined) return;
  const nick = sanitizeNick($('nick').value);
  const room = String($('room').value || '').trim().toUpperCase();
  if (!room) return showJoinError('방 코드를 입력하세요.');
  showJoinError('');
  $('enter').disabled = true;

  const spawn = { x: 0.2 + Math.random() * 0.6, y: 0.78 + Math.random() * 0.16 };
  const self = { peerId: state.peerId, nick, animal: state.selectedAnimal, x: spawn.x, y: spawn.y };
  state.local = makeActor({ id: self.peerId, nick, animal: self.animal, x: spawn.x, y: spawn.y, isLocal: true });
  state.world.set(self.peerId, state.local);

  try {
    const signaling = createSignaling(state.config);
    state.mesh = new Mesh({ signaling, identity: state.identity, self });
    wireMesh(state.mesh);
    await state.mesh.start(room);
  } catch (err) {
    state.world.delete(self.peerId);
    state.local = null;
    $('enter').disabled = false;
    return showJoinError(err.message || String(err));
  }

  state.joined = true;
  $('join').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('hud-room').textContent = room;
  window.overlay?.focus();
  updateInteractive();
}

// ---------------------------------------------------------------- mesh wiring
function ensureActor(id, meta = {}) {
  let a = state.world.get(id);
  if (!a) {
    a = makeActor({ id, nick: meta.nick || '', animal: meta.animal || 'cat', x: meta.x ?? 0.5, y: meta.y ?? 0.9 });
    state.world.set(id, a);
  }
  return a;
}

function wireMesh(mesh) {
  mesh.on(MESH_EVENT.PEER_JOIN, ({ id, nick, animal, x, y }) => {
    const a = ensureActor(id, { nick, animal, x, y });
    a.nick = nick; a.animal = animal;
    if (typeof x === 'number') a.x = clampX(x);
    if (typeof y === 'number') a.y = clampY(y);
  });
  mesh.on(MESH_EVENT.PEER_LEAVE, ({ id }) => state.world.delete(id));
  mesh.on(MESH_EVENT.PEER_MOVE, ({ id, state: st }) => applyMove(ensureActor(id), st));
  mesh.on(MESH_EVENT.PEER_CHAT, ({ id, text }) => addBubble(ensureActor(id), sanitizeText(text, WORLD.MAX_CHAT_LEN)));
  mesh.on(MESH_EVENT.PEER_PROFILE, ({ id, nick, animal }) => {
    const a = ensureActor(id); a.nick = nick; a.animal = animal;
  });
  mesh.on(MESH_EVENT.STATUS, (text) => { $('hud-online').textContent = text; });
}

// ---------------------------------------------------------------- input
function recomputeDirection() {
  if (!state.joined || state.chatOpen) return;
  const k = state.keys;
  const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
  if (dx === state.lastDir.dx && dy === state.lastDir.dy) return;
  state.lastDir = { dx, dy };
  applyLocalMove(dx, dy);
}

function applyLocalMove(dx, dy) {
  const a = state.local;
  settle(a); // collapse extrapolation so we send from the true current spot
  const { vx, vy } = velocityFor(dx, dy);
  applyMove(a, { x: a.x, y: a.y, vx, vy });
  // Movement is event-based: one packet at the *change*, nothing while held.
  state.mesh?.sendMove({ x: a.x, y: a.y, vx, vy });
}

const KEYMAP = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.joined && !state.chatOpen) { e.preventDefault(); openChat(); return; }
  if (state.chatOpen) return; // let the input field handle everything
  const dir = KEYMAP[e.key];
  if (dir) {
    e.preventDefault();
    if (!state.keys[dir]) { state.keys[dir] = true; recomputeDirection(); }
  }
});
window.addEventListener('keyup', (e) => {
  const dir = KEYMAP[e.key];
  if (dir && state.keys[dir]) { state.keys[dir] = false; recomputeDirection(); }
});
// Dropping focus (Alt-Tab away) would strand keys as "held"; clear them.
window.addEventListener('blur', () => {
  state.keys = { left: false, right: false, up: false, down: false };
  if (state.joined && !state.chatOpen) recomputeDirection();
});

// The global hotkey (Ctrl+Alt+C) asks us to take focus for keyboard control.
window.overlay?.onToggleControl(() => { setInteractive(true); window.overlay?.focus(); });

// ---------------------------------------------------------------- chat
function openChat() {
  state.chatOpen = true;
  // stop walking while typing
  state.keys = { left: false, right: false, up: false, down: false };
  recomputeDirection();
  $('chatbar').classList.remove('hidden');
  setInteractive(true);
  window.overlay?.focus();
  $('chat-input').focus();
}
function closeChat() {
  state.chatOpen = false;
  $('chat-input').value = '';
  $('chatbar').classList.add('hidden');
  window.overlay?.focus();
  updateInteractive();
}
$('chatbar').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = sanitizeText($('chat-input').value, WORLD.MAX_CHAT_LEN);
  if (text) {
    addBubble(state.local, text);
    state.mesh?.sendChat(text);
  }
  closeChat();
});
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
});

// ---------------------------------------------------------------- anti-drift sync
setInterval(() => {
  if (!state.joined || !state.local) return;
  if (isMoving(state.local)) {
    settle(state.local);
    state.mesh?.sendSync({ x: state.local.x, y: state.local.y, vx: state.local.vx, vy: state.local.vy });
  }
}, WORLD.SYNC_INTERVAL_MS);

// ---------------------------------------------------------------- interactive hit-test
function setInteractive(v) {
  if (state.interactive === v) return;
  state.interactive = v;
  window.overlay?.setInteractive(v);
}
function pointInRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

function cursorOverInteractive(x, y) {
  if (!state.joined) return true; // join card is up
  if (state.chatOpen) return true;
  if (pointInRect(x, y, $('hud').getBoundingClientRect())) return true;
  for (const box of state.boxes.values()) if (pointInRect(x, y, box)) return true;
  return false;
}
let lastCursor = { x: -1, y: -1 };
function updateInteractive() { setInteractive(cursorOverInteractive(lastCursor.x, lastCursor.y)); }

document.addEventListener('mousemove', (e) => {
  lastCursor = { x: e.clientX, y: e.clientY };
  updateInteractive();
});

// ---------------------------------------------------------------- render loop
const canvas = $('stage');
const ctx = canvas.getContext('2d');
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

function loop() {
  const now = Date.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.boxes.clear();

  // Draw far characters first (higher on screen = smaller y = behind).
  const actors = [...state.world.values()].sort((a, b) => posAt(a, now).y - posAt(b, now).y);
  for (const actor of actors) {
    pruneBubbles(actor, now);
    const box = drawActor(ctx, actor, canvas.width, canvas.height, dpr, now);
    if (!actor.isLocal || true) state.boxes.set(actor.id, box);
  }
  requestAnimationFrame(loop);
}
