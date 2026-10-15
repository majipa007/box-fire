// arsenal: the gun registry, through its public exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUNS, GUN_IDS, PRIMARIES, SECONDARIES, baseGun } from './index.js';
import { WEAPONS } from '../constants.js';
import { WEAPON_IDS } from '../protocol.js';

test('the three launch guns keep the plan table numbers', () => {
  const { pistol, rifle, shotgun } = GUNS;
  assert.deepEqual([pistol.slot, pistol.class, pistol.mode, pistol.dmg, pistol.head, pistol.rps, pistol.mag, pistol.reload, pistol.spreadStand, pistol.spreadMove],
    ['secondary', 'pistol', 'semi', 26, 3, 6.75, 12, 1.75, 0.3, 1.5]);
  assert.deepEqual(pistol.falloff, { from: 25, to: 40, min: 0.75 });
  assert.deepEqual([rifle.slot, rifle.class, rifle.mode, rifle.dmg, rifle.headDmg, rifle.rps, rifle.mag, rifle.reload, rifle.spreadStand, rifle.spreadMove, rifle.bloom, rifle.bloomMax],
    ['primary', 'rifle', 'auto', 30, 160, 9.75, 25, 2.5, 0.15, 2.5, 0.25, 2]);
  assert.deepEqual(rifle.falloff, { from: 20, to: 30, min: 0.8 });
  assert.deepEqual([shotgun.slot, shotgun.class, shotgun.mode, shotgun.dmg, shotgun.pellets, shotgun.head, shotgun.rps, shotgun.mag, shotgun.reload, shotgun.perShell, shotgun.spreadStand],
    ['primary', 'shotgun', 'semi', 10, 12, 2, 1.1, 5, 0.5, true, 3.5]);
  assert.deepEqual(shotgun.falloff, { from: 8, to: 18, min: 0.2 });
});

test('WEAPONS is the registry, so every existing reader sees every gun', () => {
  for (const id of GUN_IDS) assert.equal(WEAPONS[id], GUNS[id], id);
  assert.equal(WEAPONS.rifle.auto, true, 'auto is derived from the mode for older readers');
  assert.equal(WEAPONS.pistol.auto, false);
});

test('wire order: the launch guns keep snapshot indices 0, 1, 2 and keys 1, 2 in the picker', () => {
  assert.deepEqual(WEAPON_IDS, GUN_IDS);
  assert.deepEqual(GUN_IDS.slice(0, 3), ['rifle', 'pistol', 'shotgun']);
  assert.deepEqual(PRIMARIES.slice(0, 2), ['rifle', 'shotgun']);
  assert.equal(SECONDARIES[0], 'pistol');
  assert.deepEqual([...PRIMARIES, ...SECONDARIES].sort(), [...GUN_IDS].sort());
});

test('baseGun: a gun without its own model, sound or effects borrows the nearest launch gun by class', () => {
  assert.deepEqual(['pistol', 'rifle', 'shotgun', 'handcannon'].map(baseGun), ['pistol', 'rifle', 'shotgun', 'pistol']);
  assert.equal(baseGun('bolt'), 'bolt', 'power-up ids pass through untouched');
  assert.equal(baseGun('__proto__'), '__proto__');
});
