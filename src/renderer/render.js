/**
 * Sprite-sheet loading + drawing. Pure view code: it reads actor state and paints,
 * it never mutates the world.
 */
import { WORLD, posAt, isMoving } from '../shared/world.js';

let sheet = null; // { img, atlas }
let viewScale = 1; // per-viewer size multiplier on top of WORLD.SPRITE_SCALE

/** Local-only render size multiplier (does not affect other peers' screens). */
export function setViewScale(v) {
  viewScale = Math.max(0.4, Math.min(3, v || 1));
}
export function getViewScale() { return viewScale; }

export async function loadSprites() {
  const atlas = await fetch('../assets/sprites.json').then((r) => r.json());
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('sprites.png failed to load (run `npm run gen:sprites`)'));
    img.src = '../assets/sprites.png';
  });
  sheet = { img, atlas };
  return sheet;
}

export function animals() {
  return sheet ? sheet.atlas.animals : [];
}

function frameFor(actor, now) {
  const { atlas } = sheet;
  const moving = isMoving(actor, now);
  const key = moving ? 'walk' : 'idle';
  const fps = moving ? WORLD.WALK_FPS : WORLD.IDLE_FPS;
  const cols = atlas.cols[key];
  const col = cols[Math.floor((now / 1000) * fps) % cols.length];
  let row = atlas.animals.indexOf(actor.animal);
  if (row < 0) row = 0;
  return { sx: col * atlas.frameW, sy: row * atlas.frameH, w: atlas.frameW, h: atlas.frameH };
}

/** Draw one small preview frame (idle0) — used by the animal picker. */
export function drawPreview(ctx, animal, scale = 2) {
  if (!sheet) return;
  const { atlas, img } = sheet;
  let row = atlas.animals.indexOf(animal);
  if (row < 0) row = 0;
  const { frameW: w, frameH: h } = atlas;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w * scale, h * scale);
  ctx.drawImage(img, 0, row * h, w, h, 0, 0, w * scale, h * scale);
}

/**
 * @returns {{x:number,y:number,w:number,h:number}} the sprite's screen-space box
 *          (CSS px), so the caller can hit-test the cursor against it.
 */
export function drawActor(ctx, actor, canvasW, canvasH, dpr, now) {
  const { img } = sheet;
  const f = frameFor(actor, now);
  const scale = WORLD.SPRITE_SCALE * viewScale;
  const drawW = f.w * scale;
  const drawH = f.h * scale;

  const p = posAt(actor, now);
  const cssW = canvasW / dpr;
  const cssH = canvasH / dpr;
  const feetX = p.x * cssW;
  const feetY = p.y * cssH;
  const left = feetX - drawW / 2;
  const top = feetY - drawH;

  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(dpr, dpr);
  if (actor.facing < 0) {
    // Flip horizontally around the sprite's own centre.
    ctx.translate(left + drawW, top);
    ctx.scale(-1, 1);
    ctx.drawImage(img, f.sx, f.sy, f.w, f.h, 0, 0, drawW, drawH);
  } else {
    ctx.drawImage(img, f.sx, f.sy, f.w, f.h, left, top, drawW, drawH);
  }
  ctx.restore();

  drawNameTag(ctx, actor.nick, feetX, top, dpr);
  drawBubbles(ctx, actor, feetX, top, dpr, now);

  return { x: left, y: top, w: drawW, h: drawH };
}

function drawNameTag(ctx, nick, cx, topY, dpr) {
  if (!nick) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font = '600 11px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(nick).width + 10;
  const y = topY - 4;
  ctx.fillStyle = 'rgba(16,18,26,0.72)';
  roundRect(ctx, cx - w / 2, y - 13, w, 15, 5);
  ctx.fill();
  ctx.fillStyle = '#f4f1e8';
  ctx.fillText(nick, cx, y - 2);
  ctx.restore();
}

function drawBubbles(ctx, actor, cx, topY, dpr, now) {
  if (!actor.bubbles || !actor.bubbles.length) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font = '13px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  const maxW = 220;
  let y = topY - 20; // stack upward above the name tag
  // newest at the bottom (closest to the head)
  const list = actor.bubbles.slice(-WORLD.MAX_BUBBLES);
  for (let i = list.length - 1; i >= 0; i--) {
    const age = list[i].until - now;
    const alpha = Math.min(1, age / 600); // fade out in the last 600ms
    const text = list[i].text;
    const w = Math.min(maxW, ctx.measureText(text).width + 20);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(244,241,232,0.96)';
    roundRect(ctx, cx - w / 2, y - 22, w, 24, 9);
    ctx.fill();
    // little tail
    ctx.beginPath();
    ctx.moveTo(cx - 5, y + 1);
    ctx.lineTo(cx + 5, y + 1);
    ctx.lineTo(cx, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#141620';
    ctx.fillText(text, cx, y - 6);
    y -= 30;
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
