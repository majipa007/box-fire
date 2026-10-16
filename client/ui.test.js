import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, DEFAULTS, ICONS, bearing, fireMode, gunStats } from './ui.js';
import { POWER_IDS } from '../shared/protocol.js';
import { PRIMARIES, SECONDARIES } from '../shared/constants.js';
import { GUNS, GUN_IDS } from '../shared/guns/index.js'; // arsenal

test('a v1 settings object migrates to v2 with shadows on, keeping keys, aim and crosshair', () => {
  const v1 = { sens: 3.2, fov: 104, scale: 50, shadows: false, xsize: 7, xcolor: '#00ff00', primary: 'shotgun', keys: { jump: 'KeyF' } };
  const s = { ...DEFAULTS, ...migrate(v1) };
  assert.equal(s.v, 2);
  assert.equal(s.shadows, true);
  assert.equal(s.scale, 100);
  assert.equal(s.quality, 'default');
  assert.equal(s.brightness, 1);
  assert.deepEqual([s.sens, s.fov, s.xsize, s.xcolor, s.primary, s.keys.jump], [3.2, 104, 7, '#00ff00', 'shotgun', 'KeyF']);
});

test('v2 settings are left alone, and junk storage falls back to the defaults', () => {
  const v2 = { v: 2, shadows: false, scale: 70, quality: 'low', msaa: false, brightness: 1.2 };
  assert.deepEqual(migrate(v2), v2);
  for (const junk of [null, 'x', 42]) assert.deepEqual({ ...DEFAULTS, ...migrate(junk) }, DEFAULTS);
});

test('every power-up, weapon and the headshot has an icon', () => {
  for (const id of [...POWER_IDS, ...PRIMARIES, ...SECONDARIES, 'head']) assert.match(ICONS[id] ?? '', /^<svg viewBox/, id);
});

// arsenal: each gun file carries its own silhouette, { w, h, d }, facing right.
// d is written into the HUD with innerHTML, so it may hold only absolute
// straight-line path commands and numbers, and every point stays in its box.
test('every gun draws its own silhouette from its file, inside its viewBox', () => {
  const seen = new Set();
  for (const id of GUN_IDS) {
    const ic = GUNS[id].icon;
    assert.ok(ic && ic.w > 0 && ic.h > 0, `${id}: icon { w, h, d }`);
    assert.match(ic.d, /^M[MLHVZ0-9 .-]+$/, `${id}: straight-line commands only`);
    assert.ok(ICONS[id].startsWith(`<svg viewBox="0 0 ${ic.w} ${ic.h}"`) && ICONS[id].includes(ic.d), `${id}: the HUD draws the file's path`);
    assert.ok(!seen.has(ic.d), `${id}: a silhouette of its own`);
    seen.add(ic.d);
    for (const [, cmd, args] of ic.d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
      const n = args.trim() ? args.trim().split(/[ ,]+/).map(Number) : [];
      const xs = cmd === 'V' ? [] : cmd === 'H' ? n : n.filter((_, i) => i % 2 === 0);
      const ys = cmd === 'H' ? [] : cmd === 'V' ? n : n.filter((_, i) => i % 2 === 1);
      for (const x of xs) assert.ok(x >= 0 && x <= ic.w, `${id}: x ${x} outside 0..${ic.w}`);
      for (const y of ys) assert.ok(y >= 0 && y <= ic.h, `${id}: y ${y} outside 0..${ic.h}`);
      if (cmd === 'M' || cmd === 'L') assert.equal(n.length % 2, 0, `${id}: ${cmd} takes x y pairs`);
    }
  }
});

test('threat bearings run clockwise from straight ahead', () => {
  const eye = { x: 0, z: 0 };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(bearing([0, 0, -5], eye, 0), 0); // yaw 0 looks down -z
  near(bearing([5, 0, 0], eye, 0), Math.PI / 2); // right
  near(Math.abs(bearing([0, 0, 5], eye, 0)), Math.PI); // behind
  near(bearing([-5, 0, 0], eye, Math.PI / 2), 0); // turned left, it is ahead
});

// arsenal: the ammo panel names the fire mode where it changes how you shoot.
test('the ammo panel labels a burst gun with its burst, and no other gun', () => {
  assert.equal(fireMode('burst'), 'BURST ×3');
  for (const id of GUN_IDS.filter((g) => g !== 'burst')) assert.equal(fireMode(id), '', id);
  assert.equal(fireMode('bolt'), '', 'a power-up id is no gun');
});

// arsenal: the loadout cards' four bars, read off each gun's numbers.
test('the loadout stat bars rank the roster the way its numbers do', () => {
  const s = Object.fromEntries(GUN_IDS.map((id) => [id, gunStats(id)]));
  for (const id of GUN_IDS) for (const k of ['damage', 'rate', 'range', 'mobility']) assert.ok(s[id][k] > 0 && s[id][k] <= 1, `${id} ${k} ${s[id][k]}`);
  const most = (k) => GUN_IDS.reduce((a, b) => (s[b][k] > s[a][k] ? b : a));
  const least = (k) => GUN_IDS.reduce((a, b) => (s[b][k] < s[a][k] ? b : a));
  assert.equal(most('damage'), 'sniper');
  assert.ok(s.shotgun.damage > s.marksman.damage, 'a full Crusher blast outhits a Plumb round');
  assert.ok(s.handcannon.damage > s.pistol.damage && s.rifle.damage > s.smg.damage);
  assert.equal(most('rate'), 'machinepistol');
  assert.equal(least('rate'), 'shotgun');
  assert.ok(s.smg.rate > s.rifle.rate && s.rifle.rate > s.handcannon.rate);
  assert.equal(least('range'), 'shotgun');
  assert.ok(s.marksman.range > s.rifle.range && s.sniper.range > s.rifle.range, 'no falloff outranges falloff');
  assert.ok(s.rifle.range > s.smg.range && s.smg.range > s.shotgun.range);
  assert.equal(least('mobility'), 'lmg');
  assert.ok(s.sniper.mobility < s.marksman.mobility && s.marksman.mobility < s.rifle.mobility);
  assert.equal(s.smg.mobility, s.pistol.mobility, 'guns with no pace of their own move alike');
});
