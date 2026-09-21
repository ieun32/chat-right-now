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
  app.quit();
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

ipcMain.on('overlay:focus', () => {
  if (win) win.focus();
});

ipcMain.on('overlay:quit', () => app.quit());

function summon() {
  if (!win) return;
  win.show();
  win.focus();
  win.webContents.send('overlay:toggle-control');
}

function createTray() {
  // A 1px transparent image is enough; the menu is what matters.
  const image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('ChatRightNow');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Focus overlay (Ctrl+Alt+C)', click: summon },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Alt+C', summon);
});

app.on('second-instance', summon);

app.on('will-quit', () => globalShortcut.unregisterAll());

// Keep running when the overlay window is closed via IPC we don't expect on
// Windows, but quit cleanly if all windows are gone.
app.on('window-all-closed', () => app.quit());
