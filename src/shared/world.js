/**
 * World model + dead reckoning.
 *
 * Positions are stored in NORMALIZED coordinates (0..1) so that peers with
 * different monitor setups agree on where everybody is. `y` is the character's
 * FEET position (so characters sit on the ground line, not float).
 *
 * The network only ever sends *movement intent* (a start state + velocity,
 * optionally with a duration). Every client extrapolates locally. That is why
 * holding a key for 5 seconds costs exactly 2 packets instead of 150.
 */

export const WORLD = {
  // Normalized units per second. X and Y differ so that visual speed looks
  // roughly uniform on a 16:9 screen.
  SPEED_X: 0.055,
  SPEED_Y: 0.098,

  // Walkable area (leaves room for the sprite + name tag + bubble).
  MIN_X: 0.015,
  MAX_X: 0.985,
  MIN_Y: 0.12,
  MAX_Y: 0.995,

  // Anti-drift resync while moving (cheap: ~1 tiny packet every 3s per moving peer).
  SYNC_INTERVAL_MS: 3000,

  // How long a chat bubble stays on screen.
  BUBBLE_MS: 6500,
  MAX_BUBBLES: 3,
  MAX_CHAT_LEN: 200,

  // Sprite cell is 32x32; drawn at 2x.
  SPRITE_SCALE: 2,

  IDLE_FPS: 2.2,
  WALK_FPS: 8,
};

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampX(x) {
  return clamp(x, WORLD.MIN_X, WORLD.MAX_X);
}

export function clampY(y) {
  return clamp(y, WORLD.MIN_Y, WORLD.MAX_Y);
}

/**
 * Create a fresh actor record.
 * `at` is always a LOCAL timestamp (Date.now() on this machine) — we never
 * trust a remote clock, we just stamp the state when it arrives. Network
 * latency shows up as a few tens of ms of position lag, which nobody notices
 * on a walking desktop pet.
 */
export function makeActor({ id, nick, animal, x = 0.5, y = 0.9, isLocal = false, hidden = false }) {
  return {
    id,
    nick,
    animal,
    x: clampX(x),
    y: clampY(y),
    vx: 0,
    vy: 0,
    at: Date.now(),
    until: Infinity,
    facing: 1, // 1 = right, -1 = left
    isLocal,
    hidden,
    bubbles: [],
  };
}

/**
 * Apply a `move` message (or local input) to an actor.
 * dur: seconds until the actor auto-stops (used by click-to-move). null/undefined = until told otherwise.
 */
export function applyMove(actor, { x, y, vx, vy, dur }, now = Date.now()) {
  actor.x = clampX(x);
  actor.y = clampY(y);
  actor.vx = vx || 0;
  actor.vy = vy || 0;
  actor.at = now;
  actor.until = dur == null || !isFinite(dur) ? Infinity : now + dur * 1000;
  if (actor.vx > 0) actor.facing = 1;
  else if (actor.vx < 0) actor.facing = -1;
  return actor;
}

/** Elapsed seconds of motion, capped at the auto-stop time. */
function movedSeconds(actor, t) {
  const end = Math.min(t, actor.until);
  return Math.max(0, (end - actor.at) / 1000);
}

/** Dead-reckoned position at time `t`. Pure function — identical on every peer. */
export function posAt(actor, t = Date.now()) {
  if (!actor.vx && !actor.vy) return { x: actor.x, y: actor.y };
  const dt = movedSeconds(actor, t);
  return {
    x: clampX(actor.x + actor.vx * dt),
    y: clampY(actor.y + actor.vy * dt),
  };
}

export function isMoving(actor, t = Date.now()) {
  return (actor.vx !== 0 || actor.vy !== 0) && t < actor.until;
}

/** Collapse extrapolated motion back into the base state (used before re-sending). */
export function settle(actor, t = Date.now()) {
  const p = posAt(actor, t);
  actor.x = p.x;
  actor.y = p.y;
  actor.at = t;
  if (!isMoving(actor, t)) {
    actor.vx = 0;
    actor.vy = 0;
    actor.until = Infinity;
  }
  return actor;
}

/** Velocity vector for a keyboard direction (-1/0/1 on each axis), diagonal-normalized. */
export function velocityFor(dx, dy) {
  if (!dx && !dy) return { vx: 0, vy: 0 };
  const k = dx && dy ? Math.SQRT1_2 : 1;
  return { vx: dx * WORLD.SPEED_X * k, vy: dy * WORLD.SPEED_Y * k };
}

/**
 * Click-to-move: one packet describing the whole trip.
 * Converts to a screen-space straight line so diagonal walks look natural.
 */
export function moveToTarget(from, to) {
  const tx = clampX(to.x);
  const ty = clampY(to.y);
  // Work in "speed-normalized" space so that the trip takes the same time
  // regardless of direction.
  const ux = (tx - from.x) / WORLD.SPEED_X;
  const uy = (ty - from.y) / WORLD.SPEED_Y;
  const dur = Math.hypot(ux, uy);
  if (dur < 0.02) return null;
  return {
    x: from.x,
    y: from.y,
    vx: (tx - from.x) / dur,
    vy: (ty - from.y) / dur,
    dur,
  };
}

export function addBubble(actor, text) {
  actor.bubbles.push({ text, until: Date.now() + WORLD.BUBBLE_MS });
  if (actor.bubbles.length > WORLD.MAX_BUBBLES) {
    actor.bubbles.splice(0, actor.bubbles.length - WORLD.MAX_BUBBLES);
  }
}

export function pruneBubbles(actor, t = Date.now()) {
  if (!actor.bubbles.length) return;
  actor.bubbles = actor.bubbles.filter((b) => b.until > t);
}
