// End-to-end check for the "인내의 숲" jump-map, mirroring tools/smoke-electron.cjs:
// two real renderers in offscreen Electron windows, joined to the same TOWER room
// over local WebRTC. Verifies the seed-derived map is identical on both peers,
// that jumping climbs, that an in-viewport attacker knocks the victim, and that
// the live ranking renders. No production Supabase or user data is touched.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const { WebSocketServer } = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server, sockets;
const windows = [];
const read = (win, code) => win.webContents.executeJavaScript(code);
async function until(win, code, label) {
  for (let i = 0; i < 150; i++) { if (await read(win, code)) return; await wait(100); }
  throw Error(`Timeout: ${label}`);
}
async function key(win, key, type = 'keydown') {
  await read(win, `window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:${JSON.stringify(key)},bubbles:true}))`);
}
async function capture(win, name) {
  win.webContents.invalidate();
  await wait(180);
  fs.writeFileSync(path.join(root, 'dist', name + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}

app.whenReady().then(async () => {
  const source = fs.readFileSync(path.join(root, 'src/renderer/renderer.js'), 'utf8');
  await build({ stdin: { contents: source + '\nwindow.__qa = { state, gameplay: () => gameplay, tower: () => tower };', resolveDir: path.join(root, 'src/renderer') }, bundle: true, format: 'iife', platform: 'browser', outfile: path.join(root, 'dist/qa-renderer.js') });
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/config.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ signaling: 'local', local: { url: `ws://127.0.0.1:${server.address().port}/signal` } })); return; }
    const file = pathname === '/' ? path.join(root, 'src/renderer/index.html') : pathname === '/renderer.js' ? path.join(root, 'dist/qa-renderer.js') : pathname === '/styles.css' ? path.join(root, 'src/renderer/styles.css') : pathname.startsWith('/assets/') ? path.join(root, pathname) : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(file); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' })[ext] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  sockets = new WebSocketServer({ server, path: '/signal' });
  const peers = new Map();
  const roster = () => { for (const [, p] of peers) p.ws.send(JSON.stringify({ t: 'peers', peers: [...peers.values()].map((v) => v.meta) })); };
  sockets.on('connection', (ws) => {
    let id;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'join') { id = m.meta.peerId; peers.set(id, { ws, meta: m.meta }); roster(); }
      if (m.t === 'presence' && peers.has(id)) { peers.get(id).meta = m.meta; roster(); }
      if (m.t === 'signal') peers.get(m.to)?.ws.send(JSON.stringify({ t: 'signal', from: id, to: m.to, data: m.data }));
    });
    ws.on('close', () => { peers.delete(id); roster(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  for (const action of ['check', 'download', 'install']) ipcMain.handle(`updates:${action}`, () => {});
  ipcMain.handle('updates:getState', () => ({ version: '0.3.0', status: 'current', percent: 0 }));
  ipcMain.on('overlay:hide', (event) => event.sender.send('overlay:visibility', false));

  for (let i = 0; i < 2; i++) {
    const win = new BrowserWindow({ show: false, width: 1100, height: 850, useContentSize: true, webPreferences: { preload: path.join(root, 'src/main/preload.js'), backgroundThrottling: false, offscreen: true } });
    windows.push(win); win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) console.error(msg); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(win, '!!window.__qa?.tower() && document.querySelectorAll("#animals .slot").length === 8', 'ready');
    await read(win, `window.__clears=0; const original=CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='stage')window.__clears++;return original.apply(this,args)};void 0;`);
    await wait(250);
    assert.equal(await read(win, 'window.__clears'), 0, 'join screen does not redraw the desktop canvas');
    await read(win, `document.body.style.background='#252936';document.getElementById('room').value='TOWER';document.getElementById('nick').value='${i ? 'Rabbit' : 'Cat'}';window.__qa.state.selectedAnimal='${i ? 'rabbit' : 'cat'}';document.getElementById('tower-mode').click();`);
    await read(win, `document.getElementById('enter').click()`);
    await until(win, 'window.__qa.state.joined && window.__qa.state.towerMode', 'join');
  }
  const [a, b] = windows;
  await until(a, 'window.__qa.state.world.size===2 && [...window.__qa.state.mesh.peers.values()].every(p=>p.dc?.readyState==="open")', 'mesh');
  await until(b, 'window.__qa.state.world.size===2', 'other mesh');
  await wait(600);

  const viewport = await read(a, `(() => {const r=document.getElementById('stage').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:innerHeight-r.bottom}})()`);
  assert.equal(viewport.w, 360);
  assert.equal(viewport.h, 600);
  assert.ok(Math.abs(viewport.x-16)<1 && Math.abs(viewport.bottom-78)<1, 'phone-sized lower-left viewport');
  await read(a, `document.getElementById('tower-size').value='1.2';document.getElementById('tower-size').dispatchEvent(new Event('input'));`);
  assert.equal(await read(a, "document.getElementById('stage').clientWidth"), 432, 'map slider resizes drawing area');
  assert.equal(await read(a, "Math.round(document.getElementById('stage').width / Math.min(devicePixelRatio,2))"), 432, 'canvas allocation follows map size');
  await read(a, `document.getElementById('tower-size').value='1';document.getElementById('tower-size').dispatchEvent(new Event('input'));`);
  await key(a, 'Escape');
  await until(a, 'window.__qa.state.hidden', 'Escape hides');
  const hiddenClears = await read(a, 'window.__clears');
  await wait(300);
  assert.equal(await read(a, 'window.__clears'), hiddenClears, 'hidden canvas performs no drawing');
  a.webContents.send('overlay:visibility', true);
  await until(a, `!window.__qa.state.hidden && window.__clears > ${hiddenClears}`, 'show resumes rendering');
  console.log('PASS: static/hidden canvas draws=0; map canvas 360x600 instead of 1100x850 (77% fewer pixels).');

  // 1) Same salt → byte-identical tower on both peers.
  const platsA = await read(a, 'JSON.stringify(window.__qa.tower().debug().map.platforms)');
  const platsB = await read(b, 'JSON.stringify(window.__qa.tower().debug().map.platforms)');
  assert.equal(platsA, platsB, 'both peers derived the identical tower');
  assert.ok(JSON.parse(platsA).length > 10, 'tower has platforms');

  // 2) Jumping climbs: maxH rises above the ground.
  await read(a, 'document.getElementById("stage").focus()');
  await key(a, ' '); await wait(500);
  assert.ok(await read(a, 'window.__qa.tower().debug().self.maxH') > 0.15, 'jump gained height');

  // 3) Knockback: place both at the same spot, 'a' swings a club toward 'b';
  //    'b' (in 'a's viewport) is shoved — kbx becomes non-zero.
  await read(a, '{const s=window.__qa.tower().debug().self;Object.assign(s,{x:.46,h:0,vx:0,kbx:0,vy:0,grounded:true,plat:0,facing:1});}');
  await read(b, '{const s=window.__qa.tower().debug().self;Object.assign(s,{x:.5,h:0,vx:0,kbx:0,vy:0,grounded:true,plat:0});}');
  await wait(150);
  await key(a, 'f'); // attack
  await until(b, 'window.__qa.tower().debug().self.kbx > 0.1', 'knockback applied (+x)');
  await until(b, 'window.__qa.tower().debug().self.x > 0.55', 'victim slid in the attack direction');
  await capture(b, 'qa-tower-knockback');

  // 4) Ranking: give 'a' a tall max height; 'b' holds Tab and sees 'a' on top.
  await read(a, 'window.__qa.tower().debug().self.maxH = 5');
  await wait(300); // let a broadcast its new maxH to b
  await key(b, 'Tab');
  await until(b, 'document.getElementById("tower-rank-list").children.length >= 2', 'ranking rendered');
  const topNick = await read(b, 'document.querySelector("#tower-rank-list li .nm").textContent');
  assert.equal(topNick, 'Cat', 'tallest climber (Cat) ranks first');
  assert.ok(await read(b, '!document.getElementById("tower-rank").classList.contains("hidden")'), 'panel visible while Tab held');
  await capture(b, 'qa-tower-rank');
  await key(b, 'Tab', 'keyup');
  await until(b, 'document.getElementById("tower-rank").classList.contains("hidden")', 'panel hidden on release');

  await read(a, "document.getElementById('hud-leave').click()");
  await until(a, "!window.__qa.state.joined && !document.getElementById('join').classList.contains('hidden')", 'leave returns to join');
  const idleClears = await read(a, 'window.__clears');
  await wait(200);
  assert.equal(await read(a, 'window.__clears'), idleClears, 'leaving stops rendering');
  assert.ok(await read(a, "Math.abs(document.getElementById('stage').clientWidth-innerWidth)<2"), 'normal room restores full stage');
  console.log('PASS: 2-peer tower — identical seed map, climb, in-viewport knockback, live ranking.');
}).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const win of windows) win.destroy();
  for (const ws of sockets?.clients || []) ws.terminate();
  sockets?.close(); server?.close(); app.exit(process.exitCode || 0);
});
