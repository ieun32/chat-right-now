/**
 * Electron main process.
 *
 * The app is a full-screen, transparent, always-on-top overlay that sits over
 * the real Windows desktop. Empty space is click-through (setIgnoreMouseEvents),
 * so the desktop and other windows stay usable; only the interactive UI (chat
 * bar, join panel, the character sprites) captures the mouse. The renderer tells
 * us moment-to-moment whether the cursor is over something interactive.
 *
 * Movement/chat is keyboard-driven, and keyboard events only reach a focused
 * window — so we expose a global hotkey to summon/focus the overlay, and any
 * click on an interactive element focuses it naturally.
 */
const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { createUpdates } = require('./updates');

let win = null;
let tray = null;
const isMac = process.platform === 'darwin';
const shortcutLabel = isMac ? '⌘⌥' : 'Ctrl+Alt+';
const updates = createUpdates({ app, updater: autoUpdater,
  manualInstall: isMac,
  openDownload: () => shell.openExternal('https://github.com/ieun32/chat-right-now/releases/latest'),
  publish: state => {
  if (win && !win.isDestroyed()) win.webContents.send('updates:state', state);
} });

for (const action of ['getState', 'check', 'download', 'install']) {
  ipcMain.handle(`updates:${action}`, (event) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    return updates[action]();
  });
}

// Force a single instance — a second launch just focuses the existing overlay.
if (!app.requestSingleInstanceLock()) {
  console.error('[main] another ChatRightNow instance holds the lock — exiting this one.');
  app.quit();
} else {
  console.error('[main] primary instance, pid', process.pid);
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  // Leave the macOS menu bar and Dock accessible.
  const { x, y, width, height } = isMac ? primary.workArea : primary.bounds;

  win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    ...(isMac ? { type: 'panel', acceptFirstMouse: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Sit above normal windows (incl. the taskbar) without going true-fullscreen,
  // which would otherwise steal focus from everything.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Start click-through: the desktop is usable, the overlay is "not there" for
  // the mouse until the renderer says the cursor is over something interactive.
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, '../../dist/index.html'));

  // Window events cover Esc, buttons, global shortcuts, and the tray alike.
  win.on('hide', () => win?.webContents.send('overlay:visibility', false));
  win.on('show', () => win?.webContents.send('overlay:visibility', true));

  win.once('ready-to-show', () => win.show());

  win.on('closed', () => {
    win = null;
  });
}

// The renderer flips this as the cursor enters/leaves interactive regions.
ipcMain.on('overlay:set-interactive', (_e, interactive) => {
  if (!win) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

// Click-through is driven by polling the GLOBAL cursor against hotspot rects the
// renderer publishes. Polling in the main process works even when the overlay is
// not the focused window, which is exactly the case we need: clicking a character
// while another app is focused must still activate us. (The renderer's own
// mouse-move listener can't see moves reliably while the window is click-through
// and unfocused — hence this.)
let hotspots = [{ x: 0, y: 0, w: 1e6, h: 1e6 }]; // fully interactive until told otherwise
let ignoring = true; // MUST match createWindow's initial setIgnoreMouseEvents(true)
let pollTimer = null;

ipcMain.on('overlay:hotspots', (_e, rects) => {
  hotspots = Array.isArray(rects) ? rects : [];
});

function pollCursor() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const rx = p.x - b.x;
  const ry = p.y - b.y;
  const over = hotspots.some((r) => rx >= r.x && rx <= r.x + r.w && ry >= r.y && ry <= r.y + r.h);
  const shouldIgnore = !over; // over a hotspot → catch the mouse; else click-through
  if (shouldIgnore !== ignoring) {
    ignoring = shouldIgnore;
    win.setIgnoreMouseEvents(shouldIgnore, { forward: true });
  }
}

ipcMain.on('overlay:focus', () => {
  if (!win) return;
  win.moveTop();
  win.focus();
});

ipcMain.on('overlay:hide', () => { if (win) win.hide(); });

ipcMain.on('overlay:quit', () => app.quit());

function summon() {
  if (!win) return;
  win.show();
  win.focus();
  win.webContents.send('overlay:toggle-control');
}

/** Quick hide/show — the app vanishes instantly and comes back on the hotkey. */
function toggleHide() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else summon();
}

function createTray() {
  let image = nativeImage.createFromPath(path.join(__dirname, '../../assets/tray.png'));
  if (image.isEmpty()) image = nativeImage.createEmpty();
  if (isMac) image = image.resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip(`ChatRightNow v${app.getVersion()}`);
  const menu = Menu.buildFromTemplate([
    { label: `ChatRightNow v${app.getVersion()}`, enabled: false },
    { label: '업데이트 확인', click: () => { summon(); updates.check(); } },
    { label: `Show / Hide (${shortcutLabel}V)`, click: toggleHide },
    { label: `Focus overlay (${shortcutLabel}C)`, click: summon },
    { type: 'separator' },
    { label: `Quit ChatRightNow (${shortcutLabel}Q)`, click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  // Single click toggles visibility; double click focuses for keyboard control.
  // macOS single click opens the status menu; do not also hide the overlay.
  if (!isMac) {
    tray.on('click', toggleHide);
    tray.on('double-click', summon);
  }
}

app.whenReady().then(() => {
  if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
  ]));
  createWindow();
  createTray();
  win.webContents.once('did-finish-load', () => updates.check());
  pollTimer = setInterval(pollCursor, 45);
  globalShortcut.register('CommandOrControl+Alt+C', summon);
  // Quick hide/show toggle — works even while hidden, so it's the way back.
  globalShortcut.register('CommandOrControl+Alt+V', toggleHide);
  // A quit path that always works, regardless of click-through / focus state.
  globalShortcut.register('CommandOrControl+Alt+Q', () => app.quit());
});

app.on('second-instance', summon);
app.on('activate', () => {
  if (win) summon();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pollTimer) clearInterval(pollTimer);
});

// Keep running when the overlay window is closed via IPC we don't expect on
// Windows, but quit cleanly if all windows are gone.
app.on('window-all-closed', () => app.quit());
