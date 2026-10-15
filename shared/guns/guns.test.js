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

// ---- Registry validation: every gun file, by the rules in docs/guns.md ----
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POWER_IDS } from '../protocol.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'));
const CLASSES = ['pistol', 'handcannon', 'machinepistol', 'rifle', 'shotgun', 'smg', 'burst', 'lmg', 'marksman', 'sniper'];
const FIELDS = new Set(['id', 'name', 'slot', 'class', 'dmg', 'head', 'headDmg', 'rps', 'mode', 'burst', 'mag', 'reload', 'perShell', 'pellets',
  'spreadStand', 'spreadMove', 'falloff', 'bloom', 'bloomMax', 'kick', 'speed', 'fireSpeed', 'scope', 'look', 'sound', 'icon']);
// Names other games own: never use them.
const TAKEN = ['classic', 'shorty', 'frenzy', 'ghost', 'sheriff', 'stinger', 'spectre', 'bucky', 'judge', 'bulldog', 'guardian', 'phantom', 'vandal',
  'marshal', 'outlaw', 'operator', 'ares', 'odin', 'awp', 'deagle', 'desert eagle', 'glock', 'famas', 'galil', 'negev', 'wingman', 'kraber', 'peacekeeper'];
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

test('the roster: one gun per class of the brief, three sidearms and seven primaries', () => {
  assert.deepEqual(GUN_IDS.map((id) => GUNS[id].class).sort(), [...CLASSES].sort());
  assert.deepEqual(SECONDARIES.map((id) => GUNS[id].class).sort(), ['handcannon', 'machinepistol', 'pistol']);
  assert.equal(PRIMARIES.length, 7);
});

test('every gun file is listed in the index under its own file name, as plain data with no imports', () => {
  assert.deepEqual(files.map((f) => f.slice(0, -3)).sort(), [...GUN_IDS].sort(), 'files and the index list agree');
  assert.equal(new Set(GUN_IDS).size, GUN_IDS.length, 'ids are unique');
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /^\s*import\b/m, `${f} imports something`);
});

test('every gun passes the field rules', () => {
  const names = new Set();
  for (const id of GUN_IDS) {
    const g = GUNS[id];
    const at = (what) => `${id}: ${what}`;
    for (const k of Object.keys(g)) assert.ok(FIELDS.has(k) || k === 'auto', at(`unknown field ${k}`));
    assert.match(id, /^[a-z]+$/, at('id is lowercase letters'));
    assert.ok(!POWER_IDS.includes(id) && !['bolt', 'pellet', 'transient', 'head'].includes(id), at('id collides with a power-up or effect id'));
    assert.ok(typeof g.name === 'string' && g.name.length >= 2 && g.name.length <= 16, at('name'));
    assert.ok(!TAKEN.includes(g.name.toLowerCase()), at(`name ${g.name} belongs to another game`));
    assert.ok(!names.has(g.name), at('name is unique'));
    names.add(g.name);
    assert.ok(['primary', 'secondary'].includes(g.slot), at('slot'));
    assert.ok(CLASSES.includes(g.class), at('class'));
    assert.ok(['semi', 'auto', 'burst'].includes(g.mode), at('mode'));
    assert.equal(g.auto, g.mode === 'auto', at('auto follows mode'));
    assert.ok(inRange(g.dmg, 1, 200), at('dmg'));
    assert.ok(inRange(g.head, 1, 4), at('head'));
    if (g.headDmg !== undefined) assert.ok(inRange(g.headDmg, g.dmg, 300), at('headDmg'));
    assert.ok(inRange(g.rps, 0.5, 20), at('rps'));
    assert.ok(Number.isInteger(g.mag) && g.mag >= 1 && g.mag <= 150, at('mag'));
    assert.ok(inRange(g.reload, 0.2, 6), at('reload'));
    if (g.perShell !== undefined) assert.equal(g.perShell, true, at('perShell is true or left out'));
    if (g.pellets !== undefined) assert.ok(Number.isInteger(g.pellets) && g.pellets >= 2 && g.pellets <= 20, at('pellets'));
    assert.ok(inRange(g.spreadStand, 0, 15) && inRange(g.spreadMove, g.spreadStand, 20), at('spreadStand ≤ spreadMove'));
    if (g.falloff) assert.ok(g.falloff.from >= 0 && g.falloff.from < g.falloff.to && g.falloff.min > 0 && g.falloff.min <= 1, at('falloff'));
    assert.equal(g.bloom === undefined, g.bloomMax === undefined, at('bloom and bloomMax come together'));
    if (g.bloom !== undefined) assert.ok(inRange(g.bloom, 0.01, 2) && inRange(g.bloomMax, g.bloom, 6), at('bloom'));
    assert.ok(Array.isArray(g.kick) && g.kick.length === 2 && inRange(g.kick[0], 0, 8) && inRange(g.kick[1], 0, 2), at('kick'));
    if (g.speed !== undefined) assert.ok(inRange(g.speed, 0.5, 1.1), at('speed'));
    if (g.fireSpeed !== undefined) assert.ok(inRange(g.fireSpeed, 0.3, 1), at('fireSpeed'));
    assert.equal(g.mode === 'burst', !!g.burst, at('burst fields exactly when mode is burst'));
    if (g.burst) {
      const { count, rps, delay } = g.burst;
      assert.ok(Number.isInteger(count) && count >= 2 && count <= g.mag && inRange(rps, 1, 30) && inRange(delay, 0, 2), at('burst'));
      assert.ok(Math.abs(g.rps - count / (count / rps + delay)) < 0.01, at('rps is the sustained burst rate'));
    }
    if (g.scope) {
      const s = g.scope;
      assert.ok(inRange(s.fov, 10, 80) && inRange(s.inSeconds, 0.05, 1) && inRange(s.speed, 0.3, 1) && inRange(s.sens, 0.1, 1), at('scope fov, time, speed, sens'));
      assert.ok(inRange(s.spread, 0, g.spreadStand) && inRange(s.moveSpread, s.spread, 20), at('scoped spread is tighter than the hip'));
    }
    for (const k of ['look', 'sound', 'icon']) assert.ok(k in g && (g[k] === null || typeof g[k] === 'object' || typeof g[k] === 'string'), at(`${k} present (null until drawn)`));
  }
});
