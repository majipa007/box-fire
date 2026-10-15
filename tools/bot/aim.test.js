// How bots shoot: a role and an ideal range read from each gun's numbers,
// and human-like aim whose reaction and accuracy depend on skill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from '../../shared/constants.js';
import { roleOf, idealRange } from './aim.js';

test('roles come from the numbers: pellets are close, auto bursts, slow semi is precision, other semi taps', () => {
  assert.equal(roleOf(WEAPONS.shotgun), 'close');
  assert.equal(roleOf(WEAPONS.rifle), 'burst');
  assert.equal(roleOf(WEAPONS.pistol), 'tap');
  // Guns that do not exist yet: local objects, never keys added to WEAPONS.
  assert.equal(roleOf({ auto: false, rps: 1, mag: 5 }), 'precision');
  assert.equal(roleOf({ auto: false, rps: 2, mag: 8 }), 'tap');
  assert.equal(roleOf({ auto: true, rps: 12, mag: 30 }), 'burst');
  assert.equal(roleOf({ auto: true, rps: 3, pellets: 8, mag: 8 }), 'close');
});

test('ideal range: a sidearm fights at 12 m, falloff guns at 0.6 of where falloff starts, others at 18 m', () => {
  assert.equal(idealRange({ auto: false, rps: 6 }, true), 12);
  assert.equal(idealRange({ auto: false, rps: 6, falloff: { from: 25, to: 40, min: 0.75 } }, true), 12);
  assert.equal(idealRange({ auto: true, rps: 10, falloff: { from: 20, to: 30, min: 0.8 } }, false), 12);
  assert.equal(idealRange({ pellets: 12, falloff: { from: 8, to: 18, min: 0.2 } }, false), 4.8);
  assert.equal(idealRange({ auto: true, rps: 10 }, false), 18);
});
