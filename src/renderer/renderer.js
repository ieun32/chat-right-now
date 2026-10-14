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
import { loadSprites, animals, drawActor, drawPreview, setViewScale, getViewScale } from './render.js';
import { wireUpdates } from './updates.js';
import { createGameplay } from './gameplay.js';
import { createTower } from './tower.js';
import { RUN_MULTIPLIER, stunned, WEAPONS } from '../shared/combat.js';

const SCALE_KEY = 'crn.viewScale';
function loadSavedScale() {
  try {
    const v = parseFloat(localStorage.getItem(SCALE_KEY));
    if (!Number.isNaN(v)) setViewScale(v);
  } catch {}
}
function saveScale(v) { try { localStorage.setItem(SCALE_KEY, String(v)); } catch {} }

// Make sure the bundled pixel font is ready before we draw canvas text with it
// (the DOM can swap in via font-display, but <canvas> needs it explicitly loaded).
async function ensureFont() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('12px "DOSMyungjo"'),
        document.fonts.load('14px "DOSMyungjo"'),
      ]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {}
}

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
  hidden: false,
  towerMode: false,  // "인내의 숲" jump-map room
  sprinting: false,
  inventoryOpen: false,
  lastSpeed: 1,
  dragging: false,
  menuOpen: false,
  keys: { left: false, right: false, up: false, down: false },
  lastDir: { dx: 0, dy: 0 },
  boxes: new Map(),   // id -> screen box (for cursor hit-testing)
  interactive: null,  // last value pushed to the main process
};
let gameplay;
let tower;

// ---------------------------------------------------------------- boot
(async function boot() {
  if (window.overlay?.platform === 'darwin') {
    document.querySelectorAll('[title]').forEach(el => {
      el.title = el.title.replaceAll('Ctrl+Alt+', '⌘⌥');
    });
    document.querySelectorAll('.hint').forEach(el => {
      el.innerHTML = el.innerHTML.replaceAll('Ctrl+Alt+', '⌘⌥');
    });
  }
  wireUpdates();
  state.config = await fetch('./config.json').then((r) => r.json());
  await loadSprites();
  gameplay = createGameplay({ state, recomputeDirection, pushHotspots });
  tower = createTower({ state });
  await ensureFont();
  loadSavedScale();
  buildAnimalPicker();
  wireJoinScreen();
  wireSizeControl();
  wireDock();
  // The join card must be clickable, so grab the mouse until we're in-world.
  pushHotspots();
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
  // Jump-map toggle: the room code becomes the tower seed; reveal its hint.
  $('tower-mode').addEventListener('change', (e) => {
    $('tower-hint').classList.toggle('hidden', !e.target.checked);
    $('room-label').textContent = e.target.checked ? '방 코드 (맵 시드)' : '방 코드';
  });
  $('enter').onclick = join;
  $('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('hud-quit').onclick = () => window.overlay?.quit();
  $('join-close').onclick = () => window.overlay?.quit();
  $('hud-leave').onclick = () => leaveRoom();
  $('hud-hide').onclick = hideOverlay;
}

/** Disconnect from the mesh and return to the join modal so a new room can be picked. */
let leaving = false;
async function leaveRoom() {
  if (!state.joined || leaving) return;
  leaving = true;
  gameplay?.close();
  tower?.stop();
  state.towerMode = false;
  const mesh = state.mesh;
  state.mesh = null;
  try { await mesh?.stop(); } catch (err) { console.error('[leave]', err); }

  // Reset world + input back to a clean pre-join state.
  state.world.clear();
  state.local = null;
  state.joined = false;
  state.keys = { left: false, right: false, up: false, down: false };
  state.lastDir = { dx: 0, dy: 0 };
  state.boxes.clear();

  // Close chat/menu, hide HUD, show the join card again.
  state.chatOpen = false;
  $('chatbar').classList.add('hidden');
  $('chat-input').value = '';
  setMenuOpen(false);
  $('hud').classList.add('hidden');
  $('join').classList.remove('hidden');
  $('enter').disabled = false;
  showJoinError('');

  pushHotspots();
  window.overlay?.focus();
  leaving = false;
}

function wireSizeControl() {
  const slider = $('hud-size');
  const label = $('hud-size-val');
  const show = (v) => { label.textContent = `${v.toFixed(1)}×`; };
  slider.value = String(getViewScale());
  show(getViewScale());
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    setViewScale(v);
    saveScale(v);
    show(v);
  });
}

function setMenuOpen(open) {
  state.menuOpen = open;
  $('hud').classList.toggle('open', open);
  pushHotspots();
}

function wireDock() {
  $('hud-toggle').addEventListener('click', () => setMenuOpen(!state.menuOpen));
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
  state.towerMode = $('tower-mode').checked;

  const spawn = { x: 0.2 + Math.random() * 0.6, y: 0.78 + Math.random() * 0.16 };
  const self = { peerId: state.peerId, nick, animal: state.selectedAnimal, x: spawn.x, y: spawn.y, hidden: state.hidden };
  state.local = makeActor({ id: self.peerId, nick, animal: self.animal, x: spawn.x, y: spawn.y, isLocal: true });
  state.local.weapon = 'club';
  state.local.hidden = state.hidden;
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
  if (state.towerMode) tower.start(room); // seed the tower from the room code
  $('join').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('hud-room').textContent = room;
  // Move keyboard focus off the (now hidden) room input onto the canvas, or
  // WASD would be swallowed as "typing in a field".
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  window.overlay?.focus();
  $('stage').focus();
  pushHotspots();
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
  mesh.on(MESH_EVENT.PEER_JOIN, ({ id, nick, animal, x, y, hidden, weapon }) => {
    const a = ensureActor(id, { nick, animal, x, y });
    a.nick = nick; a.animal = animal;
    a.hidden = hidden === true;
    a.weapon = Object.hasOwn(WEAPONS, weapon) ? weapon : 'club';
    if (typeof x === 'number') a.x = clampX(x);
    if (typeof y === 'number') a.y = clampY(y);
  });
  mesh.on(MESH_EVENT.PEER_LEAVE, ({ id }) => { state.world.delete(id); tower?.removePeer(id); });
  mesh.on(MESH_EVENT.PEER_MOVE, ({ id, state: st }) => {
    if (state.towerMode) return; // tower rooms move via PEER_TOWER, not dead reckoning
    const actor = ensureActor(id);
    if (!stunned(actor)) applyMove(actor, st);
  });
  mesh.on(MESH_EVENT.PEER_ACTION, ({ id, action }) => {
    if (state.towerMode) tower?.receive(id, action);
    else gameplay?.receive(id, action);
  });
  mesh.on(MESH_EVENT.PEER_TOWER, ({ id, state: st }) => { ensureActor(id); tower?.receiveState(id, st); });
  mesh.on(MESH_EVENT.PEER_CHAT, ({ id, text }) => addBubble(ensureActor(id), sanitizeText(text, WORLD.MAX_CHAT_LEN)));
  mesh.on(MESH_EVENT.PEER_PROFILE, ({ id, nick, animal }) => {
    const a = ensureActor(id); a.nick = nick; a.animal = animal;
  });
  mesh.on(MESH_EVENT.PEER_AVAILABILITY, ({ id, hidden }) => {
    const actor = state.world.get(id);
    if (actor) actor.hidden = hidden;
  });
  mesh.on(MESH_EVENT.STATUS, (text) => { $('hud-online').textContent = text; });
}

// ---------------------------------------------------------------- input
function recomputeDirection() {
  if (!state.joined) return;
  const k = state.keys;
  const blocked = state.chatOpen || state.inventoryOpen || state.hidden || stunned(state.local);
  const dx = blocked ? 0 : (k.right ? 1 : 0) - (k.left ? 1 : 0);
  const dy = blocked ? 0 : (k.down ? 1 : 0) - (k.up ? 1 : 0);
  const speed = state.sprinting ? RUN_MULTIPLIER : 1;
  if (dx === state.lastDir.dx && dy === state.lastDir.dy && speed === state.lastSpeed) return;
  state.lastSpeed = speed;
  state.lastDir = { dx, dy };
  applyLocalMove(dx, dy);
}

function applyLocalMove(dx, dy) {
  const a = state.local;
  settle(a); // collapse extrapolation so we send from the true current spot
  const { vx, vy } = velocityFor(dx, dy);
  const speed = state.sprinting ? RUN_MULTIPLIER : 1;
  applyMove(a, { x: a.x, y: a.y, vx: vx * speed, vy: vy * speed });
  // Movement is event-based: one packet at the *change*, nothing while held.
  state.mesh?.sendMove({ x: a.x, y: a.y, vx: vx * speed, vy: vy * speed });
}

const KEYMAP = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
};

function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function hideOverlay() {
  gameplay?.close();
  tower?.clearInput();
  state.keys = { left: false, right: false, up: false, down: false };
  if (state.chatOpen) closeChat();
  recomputeDirection();
  setMenuOpen(false);
  window.overlay?.hide();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Let the input method consume Escape when cancelling text composition.
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (!e.repeat) hideOverlay();
    return;
  }
  if (typingInField(e)) return; // never hijack keys meant for a text field
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (state.towerMode && state.joined) {
    if (e.key === 'Enter' && !state.chatOpen) { e.preventDefault(); openChat(); return; }
    tower?.keydown(e); // movement / jump / attack / weapon / Tab-ranking
    return; // the tower owns in-world keys; never fall through to pet controls
  }
  if (gameplay?.keydown(e)) return;
  if (e.key === 'Enter' && state.joined && !state.chatOpen) { e.preventDefault(); openChat(); return; }
  if (!state.joined || state.chatOpen || state.inventoryOpen || stunned(state.local)) return;
  const dir = KEYMAP[e.key];
  if (dir) {
    e.preventDefault();
    if (!state.keys[dir]) { state.keys[dir] = true; recomputeDirection(); }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') { state.sprinting = false; recomputeDirection(); }
  if (typingInField(e)) return;
  if (state.towerMode && state.joined) { tower?.keyup(e); return; }
  const dir = KEYMAP[e.key];
  if (dir && state.keys[dir]) { state.keys[dir] = false; recomputeDirection(); }
});
// Dropping focus (Alt-Tab away) would strand keys as "held"; clear them.
window.addEventListener('blur', () => {
  state.sprinting = false;
  state.keys = { left: false, right: false, up: false, down: false };
  tower?.clearInput();
  if (state.joined && !state.chatOpen) recomputeDirection();
});

// The global hotkey (Ctrl+Alt+C) asks us to take focus for keyboard control.
window.overlay?.onToggleControl(() => { window.overlay?.focus(); $('stage').focus(); });
window.overlay?.onVisibility((visible) => {
  state.hidden = !visible;
  if (!visible) {
    gameplay?.close();
    tower?.clearInput();
    state.sprinting = false;
    state.keys = { left: false, right: false, up: false, down: false };
    state.lastDir = { dx: 0, dy: 0 };
    if (state.local) applyLocalMove(0, 0);
  }
  if (state.local) state.local.hidden = state.hidden;
  state.mesh?.setHidden(state.hidden);
});

// ---------------------------------------------------------------- chat
function openChat() {
  gameplay?.close();
  state.chatOpen = true;
  // stop walking while typing
  state.keys = { left: false, right: false, up: false, down: false };
  recomputeDirection();
  $('chatbar').classList.remove('hidden');
  pushHotspots();
  window.overlay?.focus();
  $('chat-input').focus();
}
function closeChat() {
  state.chatOpen = false;
  $('chat-input').value = '';
  $('chatbar').classList.add('hidden');
  window.overlay?.focus();
  $('stage').focus(); // hand keyboard control back to movement
  pushHotspots();
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
// ---------------------------------------------------------------- anti-drift sync
setInterval(() => {
  if (!state.joined || !state.local) return;
  if (isMoving(state.local)) {
    settle(state.local);
    state.mesh?.sendSync({ x: state.local.x, y: state.local.y, vx: state.local.vx, vy: state.local.vy });
  }
}, WORLD.SYNC_INTERVAL_MS);

// ---------------------------------------------------------------- clickable hotspots
// We hand the main process the rectangles that should catch the mouse; it polls
// the global cursor against them (works even when we're not the focused window).
function inflate(r, m) {
  return { x: r.x - m, y: r.y - m, w: r.width + 2 * m, h: r.height + 2 * m };
}
function computeHotspots() {
  // Full-screen interactive while the join card is up, chat is open, or a drag
  // is in progress (so the slider never slips out from under the cursor).
  if (!state.joined || state.chatOpen || state.dragging) {
    return [{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }];
  }
  const rects = [inflate($('hud-toggle').getBoundingClientRect(), 12)];
  if (state.inventoryOpen) {
    document.querySelectorAll('.weapon-slot').forEach(slot => rects.push(inflate(slot.getBoundingClientRect(), 6)));
  }
  if (state.menuOpen) rects.push(inflate($('hud-menu').getBoundingClientRect(), 12));
  for (const box of state.boxes.values()) rects.push({ x: box.x, y: box.y, w: box.w, h: box.h });
  return rects;
}
let lastHotspotJSON = '';
function pushHotspots() {
  const rects = computeHotspots().map((r) => ({
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h),
  }));
  const j = JSON.stringify(rects);
  if (j === lastHotspotJSON) return;
  lastHotspotJSON = j;
  window.overlay?.setHotspots(rects);
}

// A mousedown only reaches us when the cursor was over a hotspot (main let it
// through), so claim keyboard focus here and hold interactivity for the drag.
document.addEventListener('mousedown', (e) => {
  state.dragging = true;
  pushHotspots();
  window.overlay?.focus();
  const onControl = e.target && e.target.closest && e.target.closest('#hud, #chatbar, #join');
  if (!onControl && state.joined && !state.chatOpen) $('stage').focus();
});
window.addEventListener('mouseup', () => { state.dragging = false; pushHotspots(); });

// ---------------------------------------------------------------- render loop
const canvas = $('stage');
const ctx = canvas.getContext('2d');
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', () => { resize(); pushHotspots(); });
resize();

let lastHotspotPush = 0;
function loop() {
  const now = Date.now();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const actor of state.world.values()) pruneBubbles(actor, now);

  if (state.towerMode && tower?.active()) {
    // Jump-map: the tower controller owns physics, the follow-camera and drawing.
    tower.tick(now, ctx, canvas.width, canvas.height, dpr);
  } else {
    gameplay?.tick();
    state.boxes.clear();
    // Draw far characters first (higher on screen = smaller y = behind).
    const actors = [...state.world.values()].sort((a, b) => posAt(a, now).y - posAt(b, now).y);
    for (const actor of actors) {
      const box = drawActor(ctx, actor, canvas.width, canvas.height, dpr, now);
      state.boxes.set(actor.id, box);
    }
    // Republish character hotspots as they move (throttled; deduped downstream).
    if (now - lastHotspotPush > 80) { lastHotspotPush = now; pushHotspots(); }
  }
  requestAnimationFrame(loop);
}
