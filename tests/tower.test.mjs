import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOWER, hashSeed, generateTower, makeClimber, stepTower,
  landingPlatform, towerHit, applyKnockback, ranking,
} from '../src/shared/tower.js';

test('the same salt derives the identical tower, a different salt does not', () => {
  assert.equal(hashSeed('A7F3'), hashSeed('A7F3'));
  assert.notEqual(hashSeed('A7F3'), hashSeed('A7F4'));
  const a = generateTower('A7F3');
  const b = generateTower('A7F3');
  assert.deepEqual(a.platforms, b.platforms);
  assert.notDeepEqual(a.platforms, generateTower('A7F4').platforms);
  assert.ok(a.platforms[0].ground && a.platforms[0].h === 0);
  assert.ok(a.top > 0 && a.platforms.at(-1).goal === true);
});

test('every floor is physically reachable (gap below jump apex) and stays on screen', () => {
  const apex = (TOWER.JUMP_V * TOWER.JUMP_V) / (2 * TOWER.GRAVITY);
  const { platforms } = generateTower('CLIMB-ME');
  for (let i = 1; i < platforms.length; i++) {
    const gap = platforms[i].h - platforms[i - 1].h;
    assert.ok(gap > 0 && gap <= apex, `gap ${gap} must be climbable (<= ${apex})`);
    assert.ok(platforms[i].x >= TOWER.MARGIN - 1e-9 && platforms[i].x <= 1 - TOWER.MARGIN + 1e-9);
  }
});

test('one-way platforms: a climber lands only when falling through the top', () => {
  const platforms = [{ x: 0.5, w: 1, h: 0, i: 0, ground: true }, { x: 0.5, w: 0.3, h: 0.1, i: 1 }];
  // rising through from below does not catch
  assert.equal(landingPlatform(platforms, 0.5, 0.05, 0.12), null);
  // falling across the top catches
  assert.equal(landingPlatform(platforms, 0.5, 0.15, 0.08)?.i, 1);
  // off to the side: no catch
  assert.equal(landingPlatform(platforms, 0.9, 0.15, 0.08), null);
});

test('jumping off the ground lands back on a platform above', () => {
  const platforms = [{ x: 0.5, w: 1, h: 0, i: 0, ground: true }, { x: 0.5, w: 0.3, h: 0.1, i: 1 }];
  const c = makeClimber(0.5);
  stepTower(c, platforms, { dx: 0, jump: true }, 1 / 60); // take off
  assert.equal(c.grounded, false);
  for (let i = 0; i < 400 && !(c.grounded && c.h > 0.05); i++) stepTower(c, platforms, { dx: 0, jump: false }, 1 / 60);
  assert.ok(c.grounded && Math.abs(c.h - 0.1) < 1e-6);
  assert.ok(c.maxH >= 0.1);
});

test('knockback off a platform edge makes the climber fall (the core rule)', () => {
  const platforms = [{ x: 0.5, w: 1, h: 0, i: 0, ground: true }, { x: 0.2, w: 0.1, h: 0.2, i: 1 }];
  const c = makeClimber(0.2);
  c.h = 0.2; c.grounded = true; c.plat = 1;
  applyKnockback(c, 1, 'club'); // shoved toward +x, off the narrow ledge
  assert.equal(c.grounded, false);
  for (let i = 0; i < 90; i++) stepTower(c, platforms, { dx: 0, jump: false }, 1 / 60);
  assert.ok(c.grounded && c.h === 0, 'fell all the way to the ground');
  assert.ok(c.x > 0.25, 'and was pushed clear of the ledge');
});

test('standing firmly in the middle, a shove does not drop you off', () => {
  const platforms = [{ x: 0.5, w: 1, h: 0, i: 0, ground: true }, { x: 0.5, w: 0.5, h: 0.2, i: 1 }];
  const c = makeClimber(0.5);
  c.h = 0.2; c.grounded = true; c.plat = 1;
  applyKnockback(c, 1, 'gun');
  for (let i = 0; i < 90; i++) stepTower(c, platforms, { dx: 0, jump: false }, 1 / 60);
  assert.ok(c.h >= 0.2 - 1e-6, 'stayed on the wide platform');
});

test('weapons hit in front within tower range', () => {
  const atk = { weapon: 'club', x: 0.5, h: 1, facing: 1 };
  assert.ok(towerHit(atk, { x: 0.53, h: 1 }));
  assert.ok(!towerHit(atk, { x: 0.45, h: 1 }));      // behind
  assert.ok(towerHit({ ...atk, weapon: 'gun' }, { x: 0.7, h: 1 })); // longer reach
  assert.ok(!towerHit(atk, { x: 0.53, h: 1.5 }));    // out of vertical band
});

test('ranking shows the top N, plus my own row when I am below the cut', () => {
  const climbers = [
    { id: 'a', nick: 'A', maxH: 5 },
    { id: 'b', nick: 'B', maxH: 3 },
    { id: 'me', nick: 'Me', maxH: 1 },
  ];
  const r = ranking(climbers, 'me', 2);
  assert.equal(r.total, 3);
  assert.deepEqual(r.top.map((x) => x.id), ['a', 'b']);
  assert.ok(r.me && r.me.rank === 3);
  // when I'm inside the top N, there is no separate "me" row
  assert.equal(ranking(climbers, 'a', 2).me, null);
});
