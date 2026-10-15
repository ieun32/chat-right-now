const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

test('Escape hide can be restored with H; V and focus shortcut remain available', async () => {
  const shortcuts = new Map();
  const ipc = new EventEmitter();
  ipc.handle = () => {};
  let window;
  class Window extends EventEmitter {
    constructor() {
      super(); window = this; this.visible = true; this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.send = (...args) => this.messages.push(args);
    }
    setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setIgnoreMouseEvents() {}
    loadFile() {} moveTop() {} focus() { this.focused = true; }
    isDestroyed() { return false; } isVisible() { return this.visible; }
    hide() { this.visible = false; this.emit('hide'); }
    show() { this.visible = true; this.emit('show'); }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const app = new EventEmitter();
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), getVersion: () => 'test', quit() {} });
  const electron = { app, BrowserWindow: Window, ipcMain: ipc, Tray,
    globalShortcut: { register: (key, fn) => { shortcuts.set(key, fn); return true; } },
    screen: { getPrimaryDisplay: () => ({ bounds: {x:0,y:0,width:1920,height:1080} }) },
    Menu: { buildFromTemplate: x => x }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, shell: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: {} } : name === './updates' ? { createUpdates: () => ({ check() {} }) } : require(name),
    __dirname: path.join(__dirname, '../src/main'), process: { platform: 'win32', pid: 1 }, console: { error() {} }, setInterval: () => 1, clearInterval() {},
  });
  await Promise.resolve();
  ipc.emit('overlay:hide');
  assert.equal(window.visible, false);
  shortcuts.get('CommandOrControl+Alt+H')();
  assert.equal(window.visible, true);
  assert.equal(window.focused, true);
  assert.ok(window.messages.some(([event, value]) => event === 'overlay:visibility' && value === true));
  shortcuts.get('CommandOrControl+Alt+V')();
  assert.equal(window.visible, false);
  shortcuts.get('CommandOrControl+Alt+C')();
  assert.equal(window.visible, true);
});
