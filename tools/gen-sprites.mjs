// gen-sprites.mjs — generates assets/sprites.png (RGBA sprite sheet) + assets/sprites.json (atlas).
// No dependencies: hand-encoded PNG via zlib + fs. Run: node tools/gen-sprites.mjs
//
// Layout (fixed contract): 32x32 cells. Row = animal, Column = frame.
// 16 cols: idle(2), walk(4), run(4), jump(3), stunned(3). 8 rows (animals).
// Sheet: 512x256. All characters face RIGHT (app flips for left).

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CELL = 32;
const COLS = 16; // idle(2), walk(4), run(4), jump(3), stunned(3)
const ANIMALS = ['cat', 'dog', 'rabbit', 'frog', 'fox', 'bird', 'bear', 'panda'];
const SHEET_W = COLS * CELL;         // 512
const SHEET_H = ANIMALS.length * CELL; // 256

// ---- tiny RGBA canvas helpers (operate on one 32x32 cell) ----------------
// A cell is a Uint8Array of CELL*CELL*4 bytes, all transparent to start.
const TRANSPARENT = 0;

function newCell() {
  return new Uint8Array(CELL * CELL * 4);
}

function px(cell, x, y, [r, g, b, a = 255]) {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL) return;
  const i = (y * CELL + x) * 4;
  cell[i] = r; cell[i + 1] = g; cell[i + 2] = b; cell[i + 3] = a;
}

function getA(cell, x, y) {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL) return 0;
  return cell[(y * CELL + x) * 4 + 3];
}

function rect(cell, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) px(cell, xx, yy, color);
}

// 1px darker outline around every opaque pixel that borders transparency.
function outline(cell, [r, g, b]) {
  const edges = [];
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      if (getA(cell, x, y) !== 0) continue; // only paint into empty pixels
      // if any 4-neighbour is opaque, this empty pixel becomes outline
      if (getA(cell, x - 1, y) || getA(cell, x + 1, y) ||
          getA(cell, x, y - 1) || getA(cell, x, y + 1)) {
        edges.push([x, y]);
      }
    }
  }
  for (const [x, y] of edges) px(cell, x, y, [r, g, b, 255]);
}

// ---- palettes ------------------------------------------------------------
// Each animal: body, belly/accent, dark (ears/tail/details), outline.
const P = {
  cat:    { body: [242, 148, 60],  belly: [255, 210, 150], dark: [200, 110, 30],  line: [110, 55, 10] },
  dog:    { body: [150, 100, 55],  belly: [225, 195, 150], dark: [95, 60, 30],    line: [55, 32, 12] },
  rabbit: { body: [235, 235, 240], belly: [255, 255, 255], dark: [190, 190, 200], line: [110, 110, 120], nose: [235, 150, 165] },
  frog:   { body: [90, 185, 80],   belly: [200, 235, 160], dark: [55, 135, 50],   line: [25, 75, 25],   eye: [255, 240, 120] },
  fox:    { body: [225, 95, 45],   belly: [250, 245, 240], dark: [150, 55, 25],   line: [90, 30, 12] },
  bird:   { body: [70, 130, 225],  belly: [200, 225, 255], dark: [40, 85, 175],   line: [20, 45, 95],   beak: [245, 190, 70] },
  bear:   { body: [120, 85, 60],   belly: [165, 130, 100], dark: [80, 55, 35],    line: [45, 30, 18] },
  panda:  { body: [245, 245, 245], belly: [255, 255, 255], dark: [40, 40, 45],    line: [20, 20, 22] },
};

// ---- animal drawing ------------------------------------------------------
// Draw one animal frame into a fresh cell.
//   bob  : vertical body offset (0 or 1) for walk bob / idle stretch
//   legPhase : 0..3 walk leg positions; -1 = idle (legs together)
//   squash : idle breathing — 1 means squash body 1px (feet stay put)
//
// Coordinate convention: feet sit at y=31 (bottom). Head near top.
// We draw a generic quadruped/critter and specialize head details per animal.
function drawAnimal(name, { bob = 0, legPhase = -1, squash = 0, running = false, hurt = false }) {
  const cell = newCell();
  const pal = P[name];
  const cx = 16; // horizontal centre

  // Vertical anchor: feet at 31. Body block sits above the legs.
  const legLen = 3;
  const footY = 31;
  const bodyBottom = footY - legLen;        // 28
  const bodyTop = 13 + bob + squash;        // squash lowers the top => shorter body
  const bodyH = bodyBottom - bodyTop + 1;

  // --- legs (2 legs, alternating). Facing right => front leg is toward +x. ---
  // legPhase drives a simple 2-leg alternating gait.
  const gait = [
    [-1, +1], // walk0: back leg fwd, front leg back
    [0, 0],   // walk1: passing
    [+1, -1], // walk2: front fwd, back back
    [0, 0],   // walk3: passing
  ];
  let backDx = 0, frontDx = 0;
  if (legPhase >= 0) { [backDx, frontDx] = gait[legPhase]; }
  if (running) { backDx *= 2; frontDx *= 2; }
  // idle: legs straight down.
  const legW = 3;
  // back leg (left, -x side), front leg (right, +x side)
  rect(cell, cx - 5 + backDx, bodyBottom + 1, legW, legLen, pal.dark);
  rect(cell, cx + 2 + frontDx, bodyBottom + 1, legW, legLen, pal.body);

  // --- body (rounded-ish rectangle) ---
  const bw = 12;
  rect(cell, cx - bw / 2, bodyTop, bw, bodyH, pal.body);
  // trim top corners for roundness
  px(cell, cx - bw / 2, bodyTop, [0, 0, 0, TRANSPARENT]);
  px(cell, cx + bw / 2 - 1, bodyTop, [0, 0, 0, TRANSPARENT]);
  // belly patch (front-lower)
  rect(cell, cx - 1, bodyTop + 3, 6, bodyH - 4, pal.belly);

  // --- head ---
  const headY = bodyTop - 6; // head block top
  const headH = 8, headW = 10;
  const hx = cx - 1; // head shifted slightly forward (+x = facing right)
  rect(cell, hx - headW / 2, headY, headW, headH, pal.body);
  // round head corners
  px(cell, hx - headW / 2, headY, [0, 0, 0, TRANSPARENT]);
  px(cell, hx + headW / 2 - 1, headY, [0, 0, 0, TRANSPARENT]);

  // eyes (2 dots, facing right so both toward front)
  px(cell, hx + 1, headY + 3, pal.line);
  px(cell, hx + 3, headY + 3, pal.line);

  // --- per-animal distinguishing features ---
  const earTop = headY - 1;
  switch (name) {
    case 'cat': {
      // pointy triangle ears
      px(cell, hx - 4, earTop, pal.body); px(cell, hx - 4, earTop - 1, pal.dark);
      px(cell, hx + 3, earTop, pal.body); px(cell, hx + 3, earTop - 1, pal.dark);
      // long tail curling up-right
      rect(cell, cx + 5, bodyTop + 1, 2, 6, pal.dark);
      px(cell, cx + 6, bodyTop, pal.dark);
      break;
    }
    case 'dog': {
      // floppy round ears hanging down sides
      rect(cell, hx - 6, headY + 1, 2, 5, pal.dark);
      rect(cell, hx + 4, headY + 1, 2, 5, pal.dark);
      // wagging tail
      rect(cell, cx + 5, bodyTop + 2, 3, 2, pal.dark);
      // snout
      px(cell, hx + 2, headY + 5, pal.line);
      break;
    }
    case 'rabbit': {
      // tall upright ears
      rect(cell, hx - 3, earTop - 5, 2, 6, pal.body);
      rect(cell, hx + 2, earTop - 5, 2, 6, pal.body);
      px(cell, hx - 3, earTop - 5, pal.dark); px(cell, hx + 2, earTop - 5, pal.dark);
      // pink nose + fluffy tail
      px(cell, hx + 2, headY + 5, pal.nose);
      // Frames face right: the tail belongs on the rear (left) hip.
      rect(cell, cx - 8, bodyBottom - 2, 3, 3, pal.belly);
      break;
    }
    case 'frog': {
      // bulging eyes on top of head
      px(cell, hx - 3, earTop, pal.body); px(cell, hx - 3, earTop - 1, pal.eye);
      px(cell, hx + 2, earTop, pal.body); px(cell, hx + 2, earTop - 1, pal.eye);
      px(cell, hx - 3, earTop - 1, pal.line); // pupil hints handled by outline
      // wide mouth line
      rect(cell, hx - 3, headY + 6, 7, 1, pal.line);
      break;
    }
    case 'fox': {
      // big pointy ears + bushy white-tipped tail
      px(cell, hx - 4, earTop, pal.body); px(cell, hx - 4, earTop - 1, pal.dark);
      px(cell, hx - 3, earTop - 2, pal.dark);
      px(cell, hx + 3, earTop, pal.body); px(cell, hx + 3, earTop - 1, pal.dark);
      px(cell, hx + 2, earTop - 2, pal.dark);
      rect(cell, cx + 5, bodyTop + 2, 3, 5, pal.body);
      rect(cell, cx + 5, bodyTop + 6, 3, 2, pal.belly); // white tail tip
      break;
    }
    case 'bird': {
      // small round head, beak pointing right, tiny wing
      px(cell, hx + 5, headY + 3, pal.beak);
      px(cell, hx + 5, headY + 4, pal.beak);
      rect(cell, cx - 2, bodyTop + 2, 4, 4, pal.dark); // wing
      // little tail feathers
      rect(cell, cx + 5, bodyTop + 3, 3, 2, pal.dark);
      break;
    }
    case 'bear': {
      // small round ears on top
      rect(cell, hx - 4, earTop - 1, 2, 2, pal.dark);
      rect(cell, hx + 3, earTop - 1, 2, 2, pal.dark);
      // snout patch
      rect(cell, hx + 1, headY + 4, 3, 2, pal.belly);
      px(cell, hx + 2, headY + 4, pal.line);
      break;
    }
    case 'panda': {
      // round black ears
      rect(cell, hx - 4, earTop - 1, 3, 3, pal.dark);
      rect(cell, hx + 2, earTop - 1, 3, 3, pal.dark);
      // black eye patches
      rect(cell, hx, headY + 2, 2, 2, pal.dark);
      rect(cell, hx + 3, headY + 2, 2, 2, pal.dark);
      // black limbs already dark on back leg; make arms dark
      rect(cell, cx - bw / 2, bodyTop + 2, 2, bodyH - 3, pal.dark);
      break;
    }
  }

  if (hurt) {
    // Replace the eyes with two readable Xs and a pink tongue.
    rect(cell, hx - 3, headY + 2, 9, 6, pal.body);
    for (const eyeX of [hx - 2, hx + 3]) {
      for (let i = 0; i < 3; i++) {
        px(cell, eyeX + i - 1, headY + 2 + i, pal.line);
        px(cell, eyeX + 1 - i, headY + 2 + i, pal.line);
      }
    }
    rect(cell, hx + 1, headY + 6, 4, 1, pal.line);
    rect(cell, hx + 2, headY + 7, 2, 3, [244, 126, 156]);
    px(cell, hx + 3, headY + 9, [210, 82, 118]);
  }
  outline(cell, pal.line);
  return cell;
}

// Build the 6 frames for one animal.
function framesFor(name) {
  return [
    drawAnimal(name, { bob: 0, legPhase: -1, squash: 0 }), // idle0
    drawAnimal(name, { bob: 0, legPhase: -1, squash: 1 }), // idle1 (breathing squash)
    drawAnimal(name, { bob: 0, legPhase: 0 }),             // walk0
    drawAnimal(name, { bob: 1, legPhase: 1 }),             // walk1 (bob up)
    drawAnimal(name, { bob: 0, legPhase: 2 }),             // walk2
    drawAnimal(name, { bob: 1, legPhase: 3 }),             // walk3 (bob up)
    ...[0, 1, 2, 3].map(legPhase => drawAnimal(name, { legPhase, running: true, bob: legPhase % 2 ? -1 : 0 })),
    drawAnimal(name, { squash: 2 }), // takeoff / landing
    drawAnimal(name, { bob: -1, legPhase: 0, running: true }),
    drawAnimal(name, { bob: 0, legPhase: 2 }),
    ...[0, 1, 0].map(bob => drawAnimal(name, { bob, hurt: true })),
  ];
}

// ---- compose sheet -------------------------------------------------------
function buildSheet() {
  const sheet = new Uint8Array(SHEET_W * SHEET_H * 4);
  ANIMALS.forEach((name, row) => {
    const frames = framesFor(name);
    frames.forEach((cell, col) => {
      const ox = col * CELL, oy = row * CELL;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const si = (y * CELL + x) * 4;
          const di = ((oy + y) * SHEET_W + (ox + x)) * 4;
          sheet[di] = cell[si]; sheet[di + 1] = cell[si + 1];
          sheet[di + 2] = cell[si + 2]; sheet[di + 3] = cell[si + 3];
        }
      }
    });
  });
  return sheet;
}

// ---- minimal PNG encoder (color type 6, 8-bit RGBA) ----------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, width, height) {
  // Prepend filter byte 0 to each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // deflate / no filter / no interlace
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- main ----------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
mkdirSync(assetsDir, { recursive: true });

const sheet = buildSheet();
const png = encodePng(sheet, SHEET_W, SHEET_H);
writeFileSync(join(assetsDir, 'sprites.png'), png);

const atlas = {
  frameW: CELL,
  frameH: CELL,
  cols: { idle: [0, 1], walk: [2, 3, 4, 5], run: [6, 7, 8, 9], jump: [10, 11, 12], stunned: [13, 14, 15] },
  animals: ANIMALS,
};
writeFileSync(join(assetsDir, 'sprites.json'), JSON.stringify(atlas, null, 2) + '\n');

// Weapons and attack effects use the same native pixel grid and palette style.
const FX_COLS = 6, FX_ROWS = 5;
const fx = new Uint8Array(FX_COLS * CELL * FX_ROWS * CELL * 4);
function line(cell, x0, y0, x1, y1, color) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) px(cell, Math.round(x0 + (x1 - x0) * i / (n || 1)), Math.round(y0 + (y1 - y0) * i / (n || 1)), color);
}
const gold = [255, 207, 92], white = [255, 247, 199], orange = [248, 132, 43];
for (let row = 0; row < FX_ROWS; row++) for (let col = 0; col < FX_COLS; col++) {
  const cell = newCell();
  if (row === 0) {
    if (col === 0) { // studded dokkaebi club, diagonal
      for (let i = 0; i < 5; i++) line(cell, 5, 26 - i, 23, 8 - i, [120 + i * 12, 73 + i * 6, 36]);
      for (let i = 0; i < 10; i++) line(cell, 12, 20 - i, 24, 8 - i, [150 + i * 5, 94 + i * 3, 43]);
      for (const [x,y] of [[13,10],[19,5],[22,11],[16,16]]) rect(cell,x,y,3,3,gold);
    } else if (col === 1) {
      rect(cell,7,12,20,8,[130,146,164]);rect(cell,8,11,4,10,[75,168,240]);
      rect(cell,22,12,5,8,[75,168,240]);rect(cell,13,19,5,7,[81,88,105]);
      rect(cell,13,13,9,3,[226,234,242]);rect(cell,27,14,3,4,[60,68,86]);
    } else if (col === 2) {
      rect(cell,3,10,7,15,orange);rect(cell,5,7,3,3,gold);
      rect(cell,11,13,16,7,[124,136,150]);rect(cell,25,12,4,9,[73,81,96]);
      rect(cell,14,20,4,6,[114,71,51]);rect(cell,5,12,2,10,gold);
    }
    if (col < 3) outline(cell,[38,38,49]);
  } else if (row === 1) {
    for(let i=0;i<22;i++) {
      const a=(-1.3+i*.11)+(col-2)*.2;
      const x=Math.round(12+Math.cos(a)*14),y=Math.round(15+Math.sin(a)*14);
      rect(cell,x,y,2,2,gold);px(cell,x-1,y,white);
    }
  } else if (row === 2) {
    const r=col%2?5:8;
    for(let i=-r;i<=r;i++) { px(cell,16+i,16,gold);px(cell,16,16+i,gold); }
    rect(cell,14,14,5,5,white);rect(cell,25,15,5,2,gold);
  } else if (row === 3) {
    for(let x=2;x<31;x++) {
      const spread=Math.floor(2+x*.3);
      for(let y=16-spread;y<=16+spread;y++) {
        if((x+y+col)%7===0 && Math.abs(y-16)>spread-2)continue;
        px(cell,x,y,Math.abs(y-16)<spread*.4?white:Math.abs(y-16)<spread*.7?gold:orange);
      }
    }
  } else {
    for(let i=0;i<3;i++) {
      const a=(col/6+i/3)*Math.PI*2;
      const x=Math.round(15+Math.cos(a)*11),y=Math.round(15+Math.sin(a)*5);
      rect(cell,x-3,y-1,7,3,gold);rect(cell,x-1,y-3,3,7,gold);px(cell,x,y,white);
    }
  }
  for(let y=0;y<CELL;y++) for(let x=0;x<CELL;x++) {
    const from=(y*CELL+x)*4,to=((row*CELL+y)*FX_COLS*CELL+col*CELL+x)*4;
    fx.set(cell.subarray(from,from+4),to);
  }
}
writeFileSync(join(assetsDir,'combat.png'),encodePng(fx,FX_COLS*CELL,FX_ROWS*CELL));

// ---- self-check: dump alpha mask of one frame + confirm every animal draws ---
function alphaAscii(cell) {
  let out = '';
  for (let y = 0; y < CELL; y++) {
    let line = '';
    for (let x = 0; x < CELL; x++) line += getA(cell, x, y) ? '#' : '.';
    out += line + '\n';
  }
  return out;
}

const coverage = ANIMALS.map((name) => {
  const cell = drawAnimal(name, { legPhase: -1 });
  let opaque = 0;
  for (let i = 3; i < cell.length; i += 4) if (cell[i]) opaque++;
  return { name, opaque };
});

console.log(`Wrote assets/sprites.png (${SHEET_W}x${SHEET_H}) and assets/sprites.json`);
console.log(`PNG header: ${[...png.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
console.log('Coverage (opaque px per idle0 frame):');
for (const c of coverage) console.log(`  ${c.name.padEnd(7)} ${c.opaque}`);
console.log('\ncat idle0 alpha preview:');
process.stdout.write(alphaAscii(drawAnimal('cat', { legPhase: -1 })));
