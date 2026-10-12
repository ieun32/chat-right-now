// The installer and latest.yml are published together on GitHub Releases.
function createUpdates({ app, updater, publish = () => {}, manualInstall = false, openDownload = async () => {} }) {
  let state = { version: app.getVersion(), status: app.isPackaged ? 'idle' : 'development', percent: 0, manualInstall };
  const set = patch => { state = { ...state, ...patch }; publish({ ...state }); };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on('checking-for-update', () => set({ status: 'checking', message: '' }));
  updater.on('update-available', info => set({ status: 'available', latestVersion: info.version }));
  updater.on('update-not-available', () => set({ status: 'current', latestVersion: undefined }));
  updater.on('download-progress', info => set({ status: 'downloading', percent: Math.round(info.percent) }));
  updater.on('update-downloaded', info => set({ status: 'ready', latestVersion: info.version, percent: 100 }));
  const failed = () => set({ status: 'error', message: '업데이트 연결에 실패했습니다. 잠시 후 다시 확인해 주세요.' });
  updater.on('error', failed);
  return {
    getState: () => ({ ...state }),
    async check() {
      if (!app.isPackaged || ['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return;
      set({ status: 'checking', message: '', percent: 0 });
      try { await updater.checkForUpdates(); } catch { failed(); }
    },
    async download() {
      if (state.status !== 'available') return;
      if (manualInstall) {
        try { await openDownload(); } catch { failed(); }
        return;
      }
      set({ status: 'downloading', percent: 0 });
      try { await updater.downloadUpdate(); } catch { failed(); }
    },
    install() {
      if (manualInstall || state.status !== 'ready') return;
      set({ status: 'installing' });
      // Explicitly requested by the user; never install on an ordinary quit.
      try { updater.quitAndInstall(false, true); } catch { failed(); }
    },
  };
}
module.exports = { createUpdates };
