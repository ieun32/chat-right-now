/**
 * Sprite-sheet loading + drawing. Pure view code: it reads actor state and paints,
 * it never mutates the world.
 */
import { WORLD, posAt, isMoving } from '../shared/world.js';
import { WEAPONS, stunned, jumpHeight, JUMP_MS } from '../shared/combat.js';

let sheet = null; // { img, atlas }
let combatSheet = null;
let tileSheet = null; // jump-map tileset (assets/tiles.png)
let viewScale = 1; // per-viewer size multiplier on top of WORLD.SPRITE_SCALE

/** Column index of each tile in tiles.png (see tools/gen-tiles.mjs). */
export const TILE = { leftCap: 0, middle: 1, rightCap: 2, single: 3, goal: 4, ground: 5 };

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
  combatSheet = new Image();
  await new Promise((resolve, reject) => {
    combatSheet.onload = resolve; combatSheet.onerror = reject;
    combatSheet.src = '../assets/combat.png';
  });
  tileSheet = new Image();
  await new Promise((resolve, reject) => {
    tileSheet.onload = resolve;
    tileSheet.onerror = () => reject(new Error('tiles.png failed to load (run `npm run gen:tiles`)'));
    tileSheet.src = '../assets/tiles.png';
  });
  return sheet;
}

export function animals() {
  return sheet ? sheet.atlas.animals : [];
}

function frameFor(actor, now, ov) {
  const { atlas } = sheet;
  // `ov` (tower mode) forces the animation: { key, phase } where phase picks the
  // jump column (0 rising … 2 falling) directly instead of using jump timing.
  const moving = ov ? ov.key === 'walk' || ov.key === 'run' : isMoving(actor, now);
  const jumping = ov ? ov.key === 'jump' : jumpHeight(actor, now) > 0;
  const running = ov ? ov.key === 'run' : Math.hypot(actor.vx / WORLD.SPEED_X, actor.vy / WORLD.SPEED_Y) > 1.2;
  const key = ov ? ov.key : stunned(actor, now) ? 'stunned' : jumping ? 'jump' : moving ? (running ? 'run' : 'walk') : 'idle';
  const fps = key === 'stunned' ? 5 : running ? 12 : moving ? WORLD.WALK_FPS : WORLD.IDLE_FPS;
  const cols = atlas.cols[key];
  const col = key === 'jump'
    ? cols[ov ? Math.min(2, Math.max(0, ov.phase ?? 1)) : Math.min(2, Math.floor((now - actor.jumpStarted) / JUMP_MS * 3))]
    : cols[Math.floor((now / 1000) * fps) % cols.length];
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
export function drawActor(ctx, actor, canvasW, canvasH, dpr, now, screen) {
  const { img } = sheet;
  const f = frameFor(actor, now, screen && { key: screen.anim || 'idle', phase: screen.phase });
  const actorScale = viewScale * (screen?.scale ?? 1);
  const scale = WORLD.SPRITE_SCALE * actorScale;
  const drawW = f.w * scale;
  const drawH = f.h * scale;

  const cssW = canvasW / dpr;
  const cssH = canvasH / dpr;
  // Tower mode passes explicit screen-space feet (follow-camera); pet-chat mode
  // derives them from the normalized dead-reckoned position.
  const p = screen ? { x: screen.feetX / cssW, y: screen.feetY / cssH } : posAt(actor, now);
  const feetX = screen ? screen.feetX : p.x * cssW;
  const feetY = screen ? screen.feetY : p.y * cssH;
  const left = feetX - drawW / 2;
  const lift = screen ? 0 : jumpHeight(actor, now) * 55 * viewScale;
  const top = feetY - drawH - lift;

  if (lift > 0) {
    ctx.save();ctx.scale(dpr,dpr);ctx.fillStyle='rgba(0,0,0,.25)';
    ctx.beginPath();ctx.ellipse(feetX,feetY,drawW*.25,4,0,0,Math.PI*2);ctx.fill();ctx.restore();
  }

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

  if (actor.weapon && !actor.hidden && !stunned(actor, now)) {
    drawCombat(ctx, 0, Object.keys(WEAPONS).indexOf(actor.weapon), feetX + actor.facing * drawW * .25, top + drawH * .6, 30 * actorScale, 30 * actorScale, dpr, actor.facing);
  }
  if (!screen && actor.attack && now - actor.attack.at < WEAPONS[actor.attack.weapon].duration) {
    const attack = actor.attack, w = WEAPONS[attack.weapon], t = (now-attack.at)/w.duration;
    const originX = attack.x * cssW, originY = attack.y * cssH - drawH*.5;
    const effectW = w.range * cssW;
    if (attack.weapon === 'gun') {
      drawCombat(ctx,w.row,Math.floor(t*6)%6,originX + attack.facing * effectW*t,originY,30,30,dpr,attack.facing);
    } else {
      drawCombat(ctx,w.row,Math.floor(t*6)%6,originX+attack.facing*effectW*.5,originY,effectW,attack.weapon==='flame'?55*viewScale:drawH,dpr,attack.facing);
    }
  }

  drawNameTag(ctx, actor.nick, feetX, top, dpr);
  if (actor.hidden) drawOfflineIcon(ctx, feetX, top - 32, dpr);
  if (stunned(actor, now)) drawCombat(ctx,4,Math.floor(now/120)%6,feetX,top-(actor.hidden?57:30),48,28,dpr);
  drawBubbles(ctx, actor, feetX, top - (actor.hidden ? 26 : 0) - (stunned(actor,now)?30:0), dpr, now);

  return { x: left, y: top, w: drawW, h: drawH };
}

function drawCombat(ctx,row,col,cx,cy,w,h,dpr=1,facing=1) {
  if(!combatSheet || col<0)return;
  ctx.save();ctx.scale(dpr,dpr);ctx.translate(cx,cy);ctx.scale(facing,1);
  ctx.imageSmoothingEnabled=false;ctx.drawImage(combatSheet,col*32,row*32,32,32,-w/2,-h/2,w,h);ctx.restore();
}
export function drawWeaponPreview(ctx, weapon) {
  ctx.clearRect(0,0,64,64);
  drawCombat(ctx,0,Object.keys(WEAPONS).indexOf(weapon),32,32,64,64);
}

/** Draw one 32x32 tile from tiles.png at a screen rect (top-left), for the tower. */
export function drawTile(ctx, col, x, y, w, h, dpr = 1) {
  if (!tileSheet) return;
  ctx.save(); ctx.scale(dpr, dpr); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tileSheet, col * 32, 0, 32, 32, x, y, w, h);
  ctx.restore();
}

/** Tower attack effect / held weapon, placed at an explicit screen point. */
export function drawWeaponFx(ctx, row, col, cx, cy, w, h, dpr = 1, facing = 1) {
  drawCombat(ctx, row, col, cx, cy, w, h, dpr, facing);
}
export function weaponFxRow(weapon) { return WEAPONS[weapon]?.row ?? 0; }

/** A neutral gray Wi-Fi-off badge, above the name and below chat bubbles. */
function drawOfflineIcon(ctx, cx, cy, dpr) {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(cx, cy);
  ctx.fillStyle = 'rgba(16,18,26,0.82)';
  roundRect(ctx, -13, -12, 26, 24, 5);
  ctx.fill();
  ctx.strokeStyle = '#a0a0a0';
  ctx.fillStyle = '#a0a0a0';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const radius of [7, 12]) {
    ctx.beginPath();
    ctx.arc(0, 7, radius, -Math.PI * 0.77, -Math.PI * 0.23);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 6, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-9, -8);
  ctx.lineTo(9, 9);
  ctx.strokeStyle = '#202020';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#a0a0a0';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawNameTag(ctx, nick, cx, topY, dpr) {
  if (!nick) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font = '12px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(nick).width + 12;
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
  ctx.font = '14px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const maxW = 240;
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
