import test from 'node:test';
import assert from 'node:assert/strict';
import { hits, validAttack, jumpHeight, stunned, STUN_MS, JUMP_MS } from '../src/shared/combat.js';
import { releaseConfig } from '../tools/release-config.mjs';
test('weapons hit in front within range, including mirrored left-facing attacks', () => {
  const attack = { weapon:'club',x:.5,y:.5,facing:1 };
  assert.ok(hits(attack,{x:.53,y:.5}));
  assert.ok(!hits(attack,{x:.45,y:.5}));
  assert.ok(!hits(attack,{x:.7,y:.5}));
  assert.ok(hits({...attack,weapon:'gun'},{x:.7,y:.5}));
  assert.ok(hits({...attack,facing:-1},{x:.47,y:.5}));
  assert.ok(!validAttack({...attack,x:NaN}));
  assert.ok(!validAttack({...attack,weapon:'__proto__'}));
});
test('stun ends after three seconds and jump returns to the ground', () => {
  const actor={stunUntil:100+STUN_MS,jumpStarted:100};
  assert.ok(stunned(actor,3099));assert.ok(!stunned(actor,3100));
  assert.equal(jumpHeight(actor,100),0);assert.equal(jumpHeight(actor,100+JUMP_MS/2),1);
  assert.equal(jumpHeight(actor,100+JUMP_MS),0);
});
test('release config drops unrelated data and refuses privileged keys', () => {
  const config={supabase:{url:'https://example.supabase.co',anonKey:'sb_publishable_test'},privatePassword:'not-for-release'};
  assert.deepEqual(Object.keys(releaseConfig(config,{})),['signaling','supabase']);
  assert.throws(()=>releaseConfig({supabase:{...config.supabase,anonKey:'sb_secret_test'}},{}));
  const key='eyJ.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.sig';
  assert.throws(()=>releaseConfig({supabase:{...config.supabase,anonKey:key}},{}));
});
