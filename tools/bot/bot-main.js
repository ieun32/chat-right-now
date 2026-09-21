/**
 * Minimal Electron host for the test bot. Opens a hidden renderer that runs the
 * mesh stack and joins the room given by ROOM (env) or --room=. Forwards the
 * renderer console to stdout so we can watch the connection from the terminal.
 *
 *   ROOM=1234 npx electron tools/bot/bot-main.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return process.env[name.toUpperCase()] || fallback;
}

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 300,
    height: 200,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep timers running while hidden
    },
  });

  win.webContents.on('console-message', (_e, _level, message) => {
    process.stdout.write(message + '\n');
  });

  const room = arg('room', 'SMOKE');
  const nick = arg('nick', 'Bot');
  const animal = arg('animal', 'dog');
  const search = `room=${encodeURIComponent(room)}&nick=${encodeURIComponent(nick)}&animal=${encodeURIComponent(animal)}`;
  win.loadFile(path.join(__dirname, 'index.html'), { search });
});

app.on('window-all-closed', () => app.quit());
