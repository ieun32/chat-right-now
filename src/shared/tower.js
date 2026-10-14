/**
 * "인내의 숲" — a deterministic vertical jump-map (tower) shared by every peer.
 *
 * The whole point: there is NO server and NO authority, so the map cannot be
 * downloaded — it is *derived*. The room code is a salt. Everyone who types the
 * same salt hashes it to the same 32-bit seed, runs the same seeded RNG, and
 * therefore generates byte-identical platforms. Two players in room `A7F3` are
 * climbing literally the same tower, each through their own follow-camera.
 *
 * Coordinate system (normalized, monitor-independent):
 *   x : 0..1 across the screen WIDTH (same axis the pet-chat world uses).
 *   h : height climbed, in units of one screen HEIGHT. h=0 is the ground,
 *       h grows upward. The tower is many screen-heights tall.
 * Velocities are in those units per second. Physics is a plain fixed-ish step
 * integrator (see stepTower) so it stays identical enough across peers; the
 * network still sends periodic snapshots to correct any drift.
 */
import { WEAPONS } from './combat.js';

export const TOWER = {
  FLOORS: 46, // platforms stacked above the ground
  FLOOR_GAP: 0.215, // base vertical spacing between floors (screen-heights)
  GAP_JITTER: 0.55, // floor gap multiplier varies by ±(this/2)
  PLAT_MIN_W: 0.1, // platform width (screen-widths)
  PLAT_MAX_W: 0.26,
  MARGIN: 0.05, // keep platforms off the very edges
  MAX_DX: 0.3, // max horizontal step between consecutive floors (reachable)

  GRAVITY: 2.4, // screen-heights / s^2
  JUMP_V: 1.18, // jump take-off velocity (screen-heights / s) → ~0.29h apex
  MOVE_X: 0.44, // ground run speed (screen-widths / s)
  AIR_X: 0.4, // air control speed
  MAX_FALL: 2.4, // terminal downward speed
  FRICTION: 3.4, // knockback decay (per second)

  // Knockback impulse per weapon (screen-widths / s) + a small upward pop so the
  // victim leaves the platform and friction/gravity can carry them off an edge.
  // Tuned so a solid club hit reliably shoves you off a narrow ledge.
  KNOCKBACK: { club: 1.15, gun: 0.85, flame: 0.78 },
  KNOCKBACK_UP: 0.36,

  PLAYER_HALF: 0.018, // half the foot width, for platform-edge tests (screen-widths)
  CAM_ANCHOR: 0.62, // local player sits this far down its own screen
};

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** FNV-1a → unsigned 32-bit. Stable across machines, which is what we need. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, deterministic PRNG returning [0,1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate the tower for a salt. Pure + deterministic.
 * @returns {{ platforms: Array<{x,w,h,i,ground?,goal?}>, top: number, seed: string }}
 */
export function generateTower(salt) {
  const rng = makeRng(hashSeed(salt));
  const platforms = [{ x: 0.5, w: 1, h: 0, i: 0, ground: true }];
  let h = 0;
  let prevX = 0.5;
  for (let i = 1; i <= TOWER.FLOORS; i++) {
    h += TOWER.FLOOR_GAP * (1 - TOWER.GAP_JITTER / 2 + rng() * TOWER.GAP_JITTER);
    const w = TOWER.PLAT_MIN_W + rng() * (TOWER.PLAT_MAX_W - TOWER.PLAT_MIN_W);
    const lo = TOWER.MARGIN + w / 2;
    const hi = 1 - TOWER.MARGIN - w / 2;
    const x = clamp(prevX + (rng() * 2 - 1) * TOWER.MAX_DX, lo, hi);
    prevX = x;
    platforms.push({ x, w, h, i, goal: i === TOWER.FLOORS });
  }
  return { platforms, top: h, seed: String(salt) };
}

/** A fresh local climber state. */
export function makeClimber(x = 0.5) {
  return { x, h: 0, vx: 0, kbx: 0, vy: 0, grounded: true, plat: 0, maxH: 0, facing: 1 };
}

function onPlatform(p, x) {
  return x >= p.x - p.w / 2 - TOWER.PLAYER_HALF && x <= p.x + p.w / 2 + TOWER.PLAYER_HALF;
}

/**
 * Highest platform whose top the climber crossed while falling from hPrev→hNew
 * at column x. One-way platforms: you only land when moving downward, so you can
 * jump up through them. Returns the platform or null.
 */
export function landingPlatform(platforms, x, hPrev, hNew) {
  if (hNew >= hPrev) return null;
  let best = null;
  for (const p of platforms) {
    if (!onPlatform(p, x)) continue;
    if (p.h <= hPrev + 1e-6 && p.h >= hNew - 1e-6) {
      if (!best || p.h > best.h) best = p;
    }
  }
  return best;
}

/**
 * Advance a climber by dt seconds against the platform set.
 * @param input { dx: -1|0|1 (move), jump: bool (edge-triggered this step) }
 * Mutates and returns the climber. Pure w.r.t. its inputs.
 */
export function stepTower(c, platforms, input, dt) {
  if (dt <= 0) return c;
  if (input && input.dx) c.facing = input.dx > 0 ? 1 : -1;

  // Knockback decays toward zero under friction.
  if (c.kbx) {
    const dec = TOWER.FRICTION * dt;
    c.kbx = Math.abs(c.kbx) <= dec ? 0 : c.kbx - Math.sign(c.kbx) * dec;
  }

  // Horizontal: input control (reduced in the air) plus any knockback.
  const ctrl = (input ? input.dx : 0) * (c.grounded ? TOWER.MOVE_X : TOWER.AIR_X);
  c.vx = ctrl;
  c.x = clamp(c.x + (c.vx + c.kbx) * dt, 0, 1);

  // Jump off the ground.
  if (input && input.jump && c.grounded) {
    c.vy = TOWER.JUMP_V;
    c.grounded = false;
    c.plat = -1;
  }

  if (c.grounded) {
    // Walk/pushed off the edge of the current platform → start falling.
    const p = platforms[c.plat];
    if (!p || !onPlatform(p, c.x)) {
      c.grounded = false;
      c.plat = -1;
    }
  } else {
    // Airborne: integrate gravity and test for a landing.
    c.vy = Math.max(c.vy - TOWER.GRAVITY * dt, -TOWER.MAX_FALL);
    const hPrev = c.h;
    c.h = c.h + c.vy * dt;
    if (c.h <= 0) {
      c.h = 0;
      c.vy = 0;
      c.grounded = true;
      c.plat = 0; // the ground
    } else if (c.vy < 0) {
      const land = landingPlatform(platforms, c.x, hPrev, c.h);
      if (land) {
        c.h = land.h;
        c.vy = 0;
        c.grounded = true;
        c.plat = land.i;
      }
    }
  }

  if (c.h > c.maxH) c.maxH = c.h;
  return c;
}

/** Hit test in tower space (x in screen-widths, h in screen-heights). */
export function towerHit(attack, target) {
  const w = WEAPONS[attack.weapon];
  if (!w) return false;
  const forward = (target.x - attack.x) * attack.facing;
  return forward >= -0.015 && forward <= w.range && Math.abs(target.h - attack.h) <= w.width;
}

/**
 * Apply a hit: shove the victim along the attacker's facing and pop them up so
 * they leave the platform. If the shove carries them past a platform edge they
 * will fall (handled by stepTower).
 */
export function applyKnockback(c, facing, weapon) {
  const impulse = TOWER.KNOCKBACK[weapon] ?? 0.6;
  c.kbx = facing * impulse;
  c.vy = Math.max(c.vy, TOWER.KNOCKBACK_UP);
  c.grounded = false;
  c.plat = -1;
}

/**
 * Leaderboard. `climbers` = [{ id, nick, animal, maxH, isLocal }].
 * Returns the top `topN` by height, plus the local player's own row when they
 * fall outside the top N (so everyone always sees where they stand).
 * @returns {{ top: Array, me: object|null, total: number }}
 */
export function ranking(climbers, localId, topN = 10) {
  const ranked = [...climbers]
    .sort((a, b) => b.maxH - a.maxH || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c, i) => ({ ...c, rank: i + 1 }));
  const meIndex = ranked.findIndex((c) => c.id === localId);
  return {
    top: ranked.slice(0, topN),
    me: meIndex >= topN ? ranked[meIndex] : null,
    total: ranked.length,
  };
}
