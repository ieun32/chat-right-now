// gen-tiles.mjs — generates assets/tiles.png: the jump-map ("인내의 숲") tileset.
// No dependencies (hand-encoded PNG via zlib), same pixel style as gen-sprites.
// Run: node tools/gen-tiles.mjs
//
// Layout (fixed contract): 32x32 cells, one row, 6 columns. Transparent bg.
//   0 left-cap   1 middle   2 right-cap   3 single   4 goal flag   5 ground
// A platform is drawn as left-cap + N×middle + right-cap; a 1-tile platform
// uses `single`. The renderer samples these columns (see render.js drawTower).

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CELL = 32;
const COLS = 6;
const SHEET_W = COLS * CELL; // 192
const SHEET_H = CELL;        // 32

const newCell = () => new Uint8Array(CELL * CELL * 4);
function px(cell, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
  const i = (y * CELL + x) * 4;
  cell[i] = r; cell[i + 1] = g; cell[i + 2] = b; cell[i + 3] = a;
}
const getA = (cell, x, y) => (x < 0 || y < 0 || x >= CELL || y >= CELL ? 0 : cell[(y * CELL + x) * 4 + 3]);
function rect(cell, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(cell, xx, yy, color);
}
// 1px dark outline into transparent pixels bordering opaque ones.
function outline(cell, [r, g, b]) {
  const edges = [];
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    if (getA(cell, x, y)) continue;
    if (getA(cell, x - 1, y) || getA(cell, x + 1, y) || getA(cell, x, y - 1) || getA(cell, x, y + 1)) edges.push([x, y]);
  }
  for (const [x, y] of edges) px(cell, x, y, [r, g, b, 255]);
}

// Woodland palette: mossy grass crown over packed earth, matching the app's
// warm pixel look. `line` is the near-black outline shared with the sprites.
const GRASS = [104, 190, 92];
const GRASS_DK = [66, 148, 66];
const GRASS_HI = [158, 222, 126];
const DIRT = [142, 101, 61];
const DIRT_DK = [108, 74, 44];
const DIRT_HI = [170, 128, 84];
const LINE = [40, 30, 20];

// Fill a cell as a slab of earth with a grassy top. `edges` = which vertical
// sides are open (get rounded/overhanging grass): 'L', 'R', both, or none.
function drawSlab(cell, { left = false, right = false } = {}) {
  rect(cell, 0, 0, CELL, CELL, DIRT);
  // dirt texture: a few darker clods + lighter grains (deterministic, tiny PRNG)
  let s = 0x9e3779b1 ^ (left ? 1 : 0) ^ (right ? 2 : 0);
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 26; i++) {
    const x = (rnd() * CELL) | 0;
    const y = 8 + ((rnd() * (CELL - 9)) | 0);
    rect(cell, x, y, 1 + ((rnd() * 2) | 0), 1 + ((rnd() * 2) | 0), rnd() > 0.5 ? DIRT_DK : DIRT_HI);
  }
  // grass crown
  rect(cell, 0, 0, CELL, 6, GRASS);
  rect(cell, 0, 0, CELL, 2, GRASS_HI);
  rect(cell, 0, 6, CELL, 1, GRASS_DK);
  // drip tufts hanging a little below the crown
  for (let x = 1; x < CELL; x += 5) rect(cell, x, 6, 2, 1 + ((x / 5) % 2), GRASS_DK);
  // round the open side corners so caps read as platform ends
  if (left) {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1]]) px(cell, x, y, [0, 0, 0, 0]);
    rect(cell, 0, 7, 1, CELL - 7, [0, 0, 0, 0]);
  }
  if (right) {
    for (const [x, y] of [[CELL - 1, 0], [CELL - 2, 0], [CELL - 1, 1]]) px(cell, x, y, [0, 0, 0, 0]);
    rect(cell, CELL - 1, 7, 1, CELL - 7, [0, 0, 0, 0]);
  }
}

function makeTiles() {
  const cells = [];
  // 0 left-cap, 1 middle, 2 right-cap, 3 single
  const left = newCell(); drawSlab(left, { left: true }); outline(left, LINE); cells.push(left);
  const mid = newCell(); drawSlab(mid, {}); outline(mid, LINE); cells.push(mid);
  const right = newCell(); drawSlab(right, { right: true }); outline(right, LINE); cells.push(right);
  const single = newCell(); drawSlab(single, { left: true, right: true }); outline(single, LINE); cells.push(single);

  // 4 goal flag — a little checkered banner on a pole, planted on grass.
  const goal = newCell();
  rect(goal, 7, 4, 2, 24, [120, 96, 70]); // pole
  for (let y = 5; y < 15; y++) for (let x = 9; x < 23; x++) {
    if (x - 9 > (14 - (y - 5)) * 1.4) continue; // triangular pennant
    px(goal, x, y, ((x >> 1) + (y >> 1)) % 2 ? [255, 90, 90] : [255, 222, 120]);
  }
  rect(goal, 4, 27, 9, 4, GRASS); rect(goal, 4, 27, 9, 1, GRASS_HI);
  outline(goal, LINE); cells.push(goal);

  // 5 ground block — all earth, a bolder crown, for the base course.
  const ground = newCell();
  drawSlab(ground, {});
  rect(ground, 0, 0, CELL, 7, GRASS); rect(ground, 0, 0, CELL, 2, GRASS_HI); rect(ground, 0, 7, CELL, 1, GRASS_DK);
  cells.push(ground); // no outline: it tiles edge-to-edge along the floor
  return cells;
}

// ---- minimal PNG encoder (color type 6, 8-bit RGBA) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- compose + write ----
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
mkdirSync(assetsDir, { recursive: true });

const sheet = new Uint8Array(SHEET_W * SHEET_H * 4);
makeTiles().forEach((cell, col) => {
  const ox = col * CELL;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const si = (y * CELL + x) * 4;
    const di = (y * SHEET_W + ox + x) * 4;
    sheet[di] = cell[si]; sheet[di + 1] = cell[si + 1]; sheet[di + 2] = cell[si + 2]; sheet[di + 3] = cell[si + 3];
  }
});
writeFileSync(join(assetsDir, 'tiles.png'), encodePng(sheet, SHEET_W, SHEET_H));

const atlas = { frameW: CELL, frameH: CELL, tiles: { leftCap: 0, middle: 1, rightCap: 2, single: 3, goal: 4, ground: 5 } };
writeFileSync(join(assetsDir, 'tiles.json'), JSON.stringify(atlas, null, 2) + '\n');
console.log(`Wrote assets/tiles.png (${SHEET_W}x${SHEET_H}) and assets/tiles.json`);
