import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from '../src/net/mesh.js';
import { createIdentity } from '../src/shared/crypto.js';
import { MESH_EVENT, MSG } from '../src/shared/protocol.js';

function fixture(join = async () => {}) {
  const updates = [];
  const signaling = {
    onPeers() {}, onSignal() {}, join,
    updatePresence(patch) { updates.push(patch); },
  };
  const mesh = new Mesh({ signaling, identity: createIdentity(),
    self: { peerId: 'self', nick: 'Me', animal: 'cat', x: 0.5, y: 0.9 } });
  return { mesh, updates };
}

test('hide and show publish availability without dropping the peer connection', async () => {
  const { mesh, updates } = fixture();
  await mesh.start('TEST');
  const peer = { meta: {}, dc: { readyState: 'open' } };
  mesh.peers.set('other', peer);
  mesh.setHidden(true);
  mesh.setHidden(false);
  assert.deepEqual(updates.slice(-2), [{ hidden: true }, { hidden: false }]);
  assert.equal(mesh.peers.get('other'), peer);
});

test('visibility changes during joining are published once the subscription is ready', async () => {
  let finishJoin;
  const { mesh, updates } = fixture(() => new Promise(resolve => { finishJoin = resolve; }));
  const joining = mesh.start('TEST');
  mesh.setHidden(true);
  assert.equal(updates.length, 0);
  finishJoin();
  await joining;
  assert.deepEqual(updates, [{ hidden: true }]);
});

test('presence updates reach existing peers and distinguish offline counts', () => {
  const { mesh } = fixture();
  mesh.peers.set('other', { meta: {}, dc: { readyState: 'open' } });
  const events = [], statuses = [];
  mesh.on(MESH_EVENT.PEER_AVAILABILITY, e => events.push(e));
  mesh.on(MESH_EVENT.STATUS, s => statuses.push(s));
  mesh._reconcile([{ peerId: 'other', hidden: true }]);
  assert.deepEqual(events.at(-1), { id: 'other', hidden: true });
  assert.equal(statuses.at(-1), '1명 온라인 · 1명 오프라인');
  mesh._reconcile([{ peerId: 'other', hidden: false }]);
  assert.equal(statuses.at(-1), '2명 온라인');
});

test('late joiners receive hidden state and fresh presence wins over an older hello', () => {
  const { mesh } = fixture();
  const frames = [];
  mesh.self.hidden = true;
  mesh.peers.set('other', { meta: { hidden: false }, dc: {
    readyState: 'open', send(raw) { frames.push(JSON.parse(raw)); },
  } });
  mesh._sendHello('other');
  assert.equal(frames[0].hidden, true);
  let joined;
  mesh.on(MESH_EVENT.PEER_JOIN, e => { joined = e; });
  mesh._onMessage('other', JSON.stringify({ t: MSG.HELLO, peerId: 'other', hidden: true }));
  assert.equal(joined.hidden, false);
});
