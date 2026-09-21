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
const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');

let win = null;
let tray = null;

// Force a single instance — a second launch just focuses the existing overlay.
if (!app.requestSingleInstanceLock()) {
  console.error('[main] another ChatRightNow instance holds the lock — exiting this one.');
  app.quit();
} else {
  console.error('[main] primary instance, pid', process.pid);
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.bounds;

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
  tray = new Tray(image);
  tray.setToolTip('ChatRightNow');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide (Ctrl+Alt+H)', click: toggleHide },
    { label: 'Focus overlay (Ctrl+Alt+C)', click: summon },
    { type: 'separator' },
    { label: 'Quit ChatRightNow (Ctrl+Alt+Q)', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  // Single click toggles visibility; double click focuses for keyboard control.
  tray.on('click', toggleHide);
  tray.on('double-click', summon);
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  pollTimer = setInterval(pollCursor, 45);
  globalShortcut.register('CommandOrControl+Alt+C', summon);
  // Quick hide/show toggle — works even while hidden, so it's the way back.
  globalShortcut.register('CommandOrControl+Alt+H', toggleHide);
  // A quit path that always works, regardless of click-through / focus state.
  globalShortcut.register('CommandOrControl+Alt+Q', () => app.quit());
});

app.on('second-instance', summon);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pollTimer) clearInterval(pollTimer);
});

// Keep running when the overlay window is closed via IPC we don't expect on
// Windows, but quit cleanly if all windows are gone.
app.on('window-all-closed', () => app.quit());
