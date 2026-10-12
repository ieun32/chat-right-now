// Runs the real renderer in two isolated Electron windows against local signaling.
// No production Supabase connection, package installation, or user chat is used.
const { app, BrowserWindow, ipcMain } = require('electron');
const { build } = require('esbuild');
const { WebSocketServer } = require('ws');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, sockets;
const windows = [];
const read = (win, code) => win.webContents.executeJavaScript(code);
async function until(win, code, label) {
  for (let i=0;i<150;i++) { if(await read(win,code)) return; await wait(100); }
  throw Error(`Timeout: ${label}`);
}
async function key(win,key,type='keydown') {
  await read(win,`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:${JSON.stringify(key)},bubbles:true}))`);
}
async function capture(win,name) {
  win.webContents.invalidate();
  await wait(180);
  fs.writeFileSync(path.join(root,'dist',name+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
}
app.whenReady().then(async()=>{
  const source=fs.readFileSync(path.join(root,'src/renderer/renderer.js'),'utf8');
  await build({stdin:{contents:source+'\nwindow.__qa = { state, gameplay: () => gameplay };',resolveDir:path.join(root,'src/renderer')},bundle:true,format:'iife',platform:'browser',outfile:path.join(root,'dist/qa-renderer.js')});
  server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/config.json') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({signaling:'local',local:{url:`ws://127.0.0.1:${server.address().port}/signal`}}));return;}
    const file=pathname==='/'?path.join(root,'src/renderer/index.html'):pathname==='/renderer.js'?path.join(root,'dist/qa-renderer.js'):pathname==='/styles.css'?path.join(root,'src/renderer/styles.css'):pathname.startsWith('/assets/')?path.join(root,pathname):null;
    if(!file || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
    const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.ttf':'font/ttf'})[ext]||'application/octet-stream');res.end(fs.readFileSync(file));
  });
  sockets=new WebSocketServer({server,path:'/signal'});
  const peers=new Map();
  const roster=()=>{for(const [id,p]of peers)p.ws.send(JSON.stringify({t:'peers',peers:[...peers.values()].map(v=>v.meta)}));};
  sockets.on('connection',ws=>{
    let id;
    ws.on('message',raw=>{const m=JSON.parse(raw);
      if(m.t==='join'){id=m.meta.peerId;peers.set(id,{ws,meta:m.meta});roster();}
      if(m.t==='presence'&&peers.has(id)){peers.get(id).meta=m.meta;roster();}
      if(m.t==='signal')peers.get(m.to)?.ws.send(JSON.stringify({t:'signal',from:id,to:m.to,data:m.data}));
    });ws.on('close',()=>{peers.delete(id);roster();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for(const action of ['check','download','install'])ipcMain.handle(`updates:${action}`,()=>{});
  ipcMain.handle('updates:getState',()=>({version:'0.2.0',status:'current',percent:0}));
  ipcMain.on('overlay:hide',event=>event.sender.send('overlay:visibility',false));
  for(let i=0;i<2;i++) {
    const win=new BrowserWindow({show:false,width:1100,height:850,useContentSize:true,webPreferences:{preload:path.join(root,'src/main/preload.js'),backgroundThrottling:false,offscreen:true}});
    windows.push(win);win.webContents.on('console-message',(_e,level,msg)=>{if(level>=3)console.error(msg);});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(win,'!!window.__qa?.gameplay() && document.querySelectorAll("#animals .slot").length === 8','ready');
    await read(win,`document.body.style.background='#252936'; document.getElementById('room').value='QA';document.getElementById('nick').value='${i?'Rabbit':'Cat'}';window.__qa.state.selectedAnimal='${i?'rabbit':'cat'}';`);
    if(i===0)await capture(win,'qa-version');
    await read(win,`document.getElementById('enter').click()`);
    await until(win,'window.__qa.state.joined','join');
  }
  const [a,b]=windows;
  await until(a,'window.__qa.state.world.size===2 && [...window.__qa.state.mesh.peers.values()].every(p=>p.dc?.readyState==="open")','mesh');
  await until(b,'window.__qa.state.world.size===2','other mesh');
  await wait(800);
  async function position(win,x){await read(win,`{const s=window.__qa.state;Object.assign(s.local,{x:${x},y:.67,vx:0,vy:0,at:Date.now(),facing:1});s.mesh.sendMove({x:${x},y:.67,vx:0,vy:0});}`);}
  await position(a,.44);await position(b,.48);await wait(150);
  await key(a,'e');await capture(a,'qa-inventory');
  assert.equal(await read(a,'window.__qa.state.inventoryOpen'),true);
  await key(a,'1');
  for(const [index,weapon]of ['club','gun','flame'].entries()) {
    await key(a,'e');await key(a,String(index+1));
    await key(a,'f');
    await until(b,'window.__qa.state.local.stunUntil>Date.now()',weapon+' stun');
    await capture(b,`qa-${weapon}-hit`);
    await key(b,'ArrowRight');
    assert.equal(await read(b,'window.__qa.state.local.vx'),0);
    await wait(3100);
    await key(b,'ArrowRight');assert.ok(await read(b,'window.__qa.state.local.vx')>0);
    await key(b,'ArrowRight','keyup');await position(b,.48);await wait(100);
  }
  await key(a,'Shift');await key(a,'ArrowRight');
  assert.ok(await read(a,'window.__qa.state.local.vx')>.09);
  await key(a,' ');await wait(200);await capture(a,'qa-jump');
  await key(a,'ArrowRight','keyup');await key(a,'Shift','keyup');
  await read(a,'document.getElementById("stage").focus()');await key(a,'Escape');
  await until(b,'[...window.__qa.state.world.values()].some(a=>!a.isLocal&&a.hidden)','offline presence');
  await capture(b,'qa-offline');
  a.webContents.send('overlay:visibility',true);
  await until(b,'[...window.__qa.state.world.values()].every(a=>!a.hidden)','online presence');
  a.webContents.send('updates:state',{version:'0.2.0',status:'available',latestVersion:'0.3.0'});
  await read(a,'document.getElementById("hud-toggle").click()');await capture(a,'qa-update');
  assert.equal(await read(a,'document.querySelector("[data-update-action]").textContent'),'새 버전 다운로드');
  console.log('PASS: 2-peer WebRTC, 3 weapons, stun/recovery, running/jump, hide/show, update UI.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
  for(const win of windows)win.destroy();
  for(const ws of sockets?.clients||[])ws.terminate();
  sockets?.close();server?.close();app.exit(process.exitCode||0);
});
