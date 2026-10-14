/**
 * "인내의 숲" jump-map controller (renderer side).
 *
 * Owns the local climber's physics, the per-player follow-camera, the ~10 Hz
 * state broadcast, knockback from in-viewport attackers, and all tower drawing
 * (tiles + climbers + attack FX + the altitude/ranking HUD). The map itself is
 * pure and seed-derived (src/shared/tower.js), so nothing about the layout ever
 * travels over the wire — only each climber's live position.
 */
import { MSG } from '../shared/protocol.js';
import { WEAPONS } from '../shared/combat.js';
import {
  TOWER, generateTower, makeClimber, stepTower, towerHit, applyKnockback, ranking, clamp,
} from '../shared/tower.js';
import { drawActor, drawTile, drawWeaponFx, weaponFxRow, TILE } from './render.js';

const VIEW_H = 1.5; // screen-heights of the tower visible at once (vertical zoom-out)
const BROADCAST_MS = 90; // climber snapshot cadence
const WEAPON_KEYS = Object.keys(WEAPONS); // ['club','gun','flame']

export function createTower({ state }) {
  const rankPanel = document.getElementById('tower-rank');
  const rankList = document.getElementById('tower-rank-list');
  const hud = document.getElementById('tower-hud');
  const hudFloor = document.getElementById('tower-floor');
  const hudWeapon = document.getElementById('tower-weapon');

  let map = null; // { platforms, top, seed }
  let self = null; // local climber physics
  const peers = new Map(); // id -> { x, h, vx, vy, grounded, maxH, facing, weapon, at, fx }
  const input = { left: false, right: false, jump: false };
  let lastTick = 0;
  let lastBroadcast = 0;
  let rankHeld = false;

  function start(seed) {
    map = generateTower(seed);
    self = makeClimber(0.5);
    peers.clear();
    lastTick = performance.now();
    lastBroadcast = 0;
    rankHeld = false;
    rankPanel.classList.add('hidden');
    hud.classList.remove('hidden');
    if (state.local) state.local.weapon = state.local.weapon || 'club';
  }

  function stop() {
    map = null; self = null; peers.clear();
    input.left = input.right = input.jump = false;
    rankHeld = false;
    hud.classList.add('hidden');
    rankPanel.classList.add('hidden');
  }

  const active = () => !!map;

  // -------------------------------------------------------------- input
  function keydown(e) {
    if (!map) return false;
    if (state.chatOpen) return false;
    const k = e.key.toLowerCase();
    if (e.key === 'Tab') { e.preventDefault(); if (!rankHeld) { rankHeld = true; refreshRank(); } return true; }
    if (['arrowleft', 'a'].includes(k)) { input.left = true; e.preventDefault(); return true; }
    if (['arrowright', 'd'].includes(k)) { input.right = true; e.preventDefault(); return true; }
    if ([' ', 'arrowup', 'w'].includes(k)) { input.jump = true; e.preventDefault(); return true; }
    if (k === 'f') { if (!e.repeat) attack(); e.preventDefault(); return true; }
    if (['1', '2', '3'].includes(k)) { equip(WEAPON_KEYS[Number(k) - 1]); e.preventDefault(); return true; }
    return false;
  }
  function keyup(e) {
    if (!map) return false;
    const k = e.key.toLowerCase();
    if (e.key === 'Tab') { rankHeld = false; rankPanel.classList.add('hidden'); return true; }
    if (['arrowleft', 'a'].includes(k)) { input.left = false; return true; }
    if (['arrowright', 'd'].includes(k)) { input.right = false; return true; }
    if ([' ', 'arrowup', 'w'].includes(k)) { input.jump = false; return true; }
    return false;
  }
  function clearInput() { input.left = input.right = input.jump = false; }

  function equip(weapon) {
    if (!weapon || !state.local) return;
    state.local.weapon = weapon;
    if (state.mesh) state.mesh.self.weapon = weapon;
    state.mesh?.sendAction({ type: MSG.EQUIP, weapon });
    if (hudWeapon) hudWeapon.textContent = WEAPONS[weapon].name;
  }

  let lastAttack = -Infinity;
  function attack() {
    if (!self || !state.local) return;
    const weapon = state.local.weapon || 'club';
    const now = performance.now();
    if (now - lastAttack < WEAPONS[weapon].cooldown) return;
    lastAttack = now;
    const action = { type: MSG.ATTACK, weapon, x: self.x, h: self.h, facing: self.facing };
    // Local attack FX (drawn from our own climber), and tell the mesh.
    self.fx = { weapon, facing: self.facing, at: Date.now() };
    state.mesh?.sendAction(action);
  }

  // -------------------------------------------------------------- network in
  function receive(id, action) {
    if (!map || !action) return;
    if (action.type === MSG.EQUIP && WEAPONS[action.weapon]) {
      const p = peers.get(id); if (p) p.weapon = action.weapon;
      return;
    }
    if (action.type !== MSG.ATTACK || !WEAPONS[action.weapon]) return;
    const p = peers.get(id);
    if (p) p.fx = { weapon: action.weapon, facing: action.facing, at: Date.now() };
    // Only an attacker INSIDE my viewport can knock me (per spec). Gate on where
    // the attacker swung (action.h), then on the weapon's hit geometry.
    if (!self) return;
    const ah = Number.isFinite(action.h) ? action.h : p ? p.h : null;
    if (ah == null || !onScreen(ah)) return;
    if (towerHit(action, { x: self.x, h: self.h })) applyKnockback(self, action.facing, action.weapon);
  }

  function receiveState(id, st) {
    if (!map) return;
    const p = peers.get(id) || {};
    peers.set(id, {
      x: clamp(st.x ?? 0.5, 0, 1), h: st.h ?? 0,
      vx: st.vx ?? 0, vy: st.vy ?? 0, grounded: !!st.grounded,
      maxH: st.maxH ?? st.h ?? 0, facing: st.facing === -1 ? -1 : 1,
      weapon: WEAPONS[st.weapon] ? st.weapon : p.weapon || 'club',
      at: performance.now(), fx: p.fx,
    });
  }
  function removePeer(id) { peers.delete(id); }

  // -------------------------------------------------------------- camera
  // The local climber sits CAM_ANCHOR down its own screen; the world scrolls.
  function cam(cssH) {
    return { lh: self ? self.h : 0, unit: cssH / VIEW_H, anchorPx: TOWER.CAM_ANCHOR * cssH };
  }
  function screenYOf(h, c) { return c.anchorPx - (h - c.lh) * c.unit; }
  function onScreen(h) {
    const cssH = window.innerHeight;
    const y = screenYOf(h, cam(cssH));
    return y >= -cssH * 0.15 && y <= cssH * 1.15;
  }

  // -------------------------------------------------------------- tick + draw
  function tick(now, ctx, canvasW, canvasH, dpr) {
    if (!map || !self) return;
    const cssW = canvasW / dpr, cssH = canvasH / dpr;

    // --- physics (local only), unless chatting / hidden ---
    const nowP = performance.now();
    let dt = (nowP - lastTick) / 1000;
    lastTick = nowP;
    dt = clamp(dt, 0, 0.05); // cap to avoid tunneling after a stall
    const frozen = state.chatOpen || state.hidden;
    const dx = frozen ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const jump = frozen ? false : input.jump;
    stepTower(self, map.platforms, { dx, jump }, dt);
    input.jump = false; // edge-triggered

    // --- broadcast snapshot at a fixed cadence ---
    if (state.mesh && nowP - lastBroadcast >= BROADCAST_MS) {
      lastBroadcast = nowP;
      state.mesh.sendTower({
        x: self.x, h: self.h, vx: self.vx, vy: self.vy,
        grounded: self.grounded, maxH: self.maxH, facing: self.facing,
        weapon: state.local?.weapon || 'club',
      });
    }

    // --- draw ---
    const c = cam(cssH);
    drawPlatforms(ctx, c, cssW, cssH, dpr, now);
    drawClimbers(ctx, c, canvasW, canvasH, cssW, cssH, dpr, now, nowP);
    updateHud();
    if (rankHeld) refreshRank();
  }

  function drawPlatforms(ctx, c, cssW, cssH, dpr, now) {
    const size = 24; // on-screen tile size (px)
    for (const p of map.platforms) {
      const y = screenYOf(p.h, c);
      if (y < -size || y > cssH + size) continue;
      const top = y - size; // platform top surface sits at p.h
      if (p.ground) {
        for (let x = 0; x < cssW; x += size) drawTile(ctx, TILE.ground, x, top, size, size, dpr);
        continue;
      }
      const leftPx = (p.x - p.w / 2) * cssW;
      const rightPx = (p.x + p.w / 2) * cssW;
      const n = Math.max(1, Math.round((rightPx - leftPx) / size));
      if (n === 1) { drawTile(ctx, TILE.single, leftPx, top, rightPx - leftPx, size, dpr); }
      else {
        const tw = (rightPx - leftPx) / n;
        for (let i = 0; i < n; i++) {
          const col = i === 0 ? TILE.leftCap : i === n - 1 ? TILE.rightCap : TILE.middle;
          drawTile(ctx, col, leftPx + i * tw, top, tw + 0.5, size, dpr);
        }
      }
      if (p.goal) drawTile(ctx, TILE.goal, (p.x) * cssW - size / 2, top - size, size, size, dpr);
    }
  }

  function drawClimbers(ctx, c, canvasW, canvasH, cssW, cssH, dpr, now, nowP) {
    // Build a render list (peers extrapolated a little), far-to-near by height.
    const list = [];
    for (const [id, p] of peers) {
      const actor = state.world.get(id);
      if (!actor || actor.hidden) continue;
      const dts = clamp((nowP - p.at) / 1000, 0, 0.25);
      const h = p.grounded ? p.h : p.h + p.vy * dts;
      const x = clamp(p.x + p.vx * dts, 0, 1);
      list.push({ actor, x, h, vx: p.vx, vy: p.vy, grounded: p.grounded, facing: p.facing, weapon: p.weapon, fx: p.fx });
    }
    if (state.local) {
      list.push({
        actor: state.local, x: self.x, h: self.h, vx: self.vx + self.kbx, vy: self.vy,
        grounded: self.grounded, facing: self.facing, weapon: state.local.weapon, fx: self.fx, isLocal: true,
      });
    }
    list.sort((a, b) => b.h - a.h); // higher h drawn first (further "up"/behind)

    for (const e of list) {
      const feetX = e.x * cssW;
      const feetY = screenYOf(e.h, c);
      if (feetY < -80 || feetY > cssH + 80) continue;
      e.actor.weapon = e.weapon || e.actor.weapon;
      e.actor.facing = e.facing;
      const anim = !e.grounded ? 'jump' : Math.abs(e.vx) > 0.02 ? 'walk' : 'idle';
      const phase = e.vy > 0.02 ? 0 : 2;
      drawActor(ctx, e.actor, canvasW, canvasH, dpr, now, { feetX, feetY, anim, phase });
      drawAttackFx(ctx, e, feetX, feetY, dpr);
    }
  }

  function drawAttackFx(ctx, e, feetX, feetY, dpr) {
    const fx = e.fx;
    if (!fx) return;
    const w = WEAPONS[fx.weapon];
    const age = Date.now() - fx.at;
    if (age < 0 || age >= w.duration) return;
    const t = age / w.duration;
    const cy = feetY - 34;
    const reach = w.range * (window.innerWidth) * 0.5; // approx screen reach
    const col = Math.floor(t * 6) % 6;
    if (fx.weapon === 'gun') {
      drawWeaponFx(ctx, w.row, col, feetX + fx.facing * (18 + reach * 2 * t), cy, 30, 30, dpr, fx.facing);
    } else {
      const ww = w.range * window.innerWidth;
      drawWeaponFx(ctx, w.row, col, feetX + fx.facing * ww * 0.5, cy, ww, fx.weapon === 'flame' ? 52 : 44, dpr, fx.facing);
    }
  }

  // -------------------------------------------------------------- HUD + ranking
  function floorOf(h) { return Math.max(0, Math.round(h / TOWER.FLOOR_GAP)); }

  function updateHud() {
    if (!self) return;
    hudFloor.textContent = `${floorOf(self.maxH)}층`;
    if (hudWeapon && state.local) hudWeapon.textContent = WEAPONS[state.local.weapon || 'club'].name;
  }

  function climberRows() {
    const rows = [];
    for (const [id, p] of peers) {
      const a = state.world.get(id);
      if (!a || a.hidden) continue;
      rows.push({ id, nick: a.nick || 'guest', animal: a.animal, maxH: p.maxH, isLocal: false });
    }
    if (state.local && self) rows.push({ id: state.peerId, nick: state.local.nick || 'guest', animal: state.local.animal, maxH: self.maxH, isLocal: true });
    return rows;
  }

  function refreshRank() {
    rankPanel.classList.remove('hidden');
    const { top, me, total } = ranking(climberRows(), state.peerId, 10);
    const row = (r) => `<li class="${r.isLocal ? 'me' : ''}"><span class="rk">${r.rank}</span><span class="nm">${escapeHtml(r.nick)}</span><span class="ht">${floorOf(r.maxH)}층</span></li>`;
    let html = top.map(row).join('');
    if (me) html += `<li class="sep" aria-hidden="true">⋯</li>` + row(me);
    rankList.innerHTML = html;
    document.getElementById('tower-rank-total').textContent = `${total}명 등반 중`;
  }

  return {
    start, stop, active, keydown, keyup, clearInput, receive, receiveState, removePeer, tick,
    // Test seam (used by tools/smoke-tower.cjs); harmless in production.
    debug: () => ({ self, peers, map }),
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
