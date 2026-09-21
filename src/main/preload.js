/**
 * Bridges the small set of overlay controls the renderer needs into an isolated
 * context. No Node APIs leak into the page.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  /** Tell the main process whether the cursor is currently over interactive UI. */
  setInteractive: (interactive) => ipcRenderer.send('overlay:set-interactive', !!interactive),
  /** Ask the main process to give this window keyboard focus. */
  focus: () => ipcRenderer.send('overlay:focus'),
  /** Hide the overlay instantly (bring back with Ctrl+Alt+H or the tray). */
  hide: () => ipcRenderer.send('overlay:hide'),
  quit: () => ipcRenderer.send('overlay:quit'),
  /** Fired when the user hits the global summon hotkey. */
  onToggleControl: (cb) => ipcRenderer.on('overlay:toggle-control', () => cb()),
});
