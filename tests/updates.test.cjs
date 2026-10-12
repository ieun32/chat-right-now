const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../src/main/updates');
function fixture(packaged = true) {
  const updater = new EventEmitter(); const calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); };
  updater.downloadUpdate = async () => { calls.push('download'); };
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  const controller = createUpdates({ app: { isPackaged: packaged, getVersion: () => '0.2.0' }, updater });
  return { updater, controller, calls };
}
test('startup check does not download or install until explicitly requested', async () => {
  const { updater, controller, calls } = fixture();
  await controller.check(); await controller.check();
  assert.deepEqual(calls, ['check']);
  updater.emit('update-available', { version: '0.3.0' });
  controller.install(); assert.equal(calls.length, 1);
  await controller.download(); await controller.download();
  assert.deepEqual(calls, ['check', 'download']);
  updater.emit('update-downloaded', { version: '0.3.0' });
  controller.install(); controller.install();
  assert.deepEqual(calls.at(-1), ['install', false, true]);
  assert.equal(calls.length, 3);
  assert.equal(updater.autoInstallOnAppQuit, false);
});
test('failed update checks leave the app usable and can be retried', async () => {
  const { updater, controller, calls } = fixture();
  updater.checkForUpdates = async () => { throw Error('offline'); };
  await controller.check(); assert.equal(controller.getState().status, 'error');
  updater.checkForUpdates = async () => { calls.push('retry'); updater.emit('update-not-available'); };
  await controller.check(); assert.equal(controller.getState().status, 'current');
});
test('development builds do not query for or install releases', async () => {
  const { controller, calls } = fixture(false);
  await controller.check(); await controller.download();controller.install();
  assert.deepEqual(calls, []);assert.equal(controller.getState().version, '0.2.0');
});
