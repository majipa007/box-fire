import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, DEFAULTS, ICONS, bearing } from './ui.js';
import { POWER_IDS } from '../shared/protocol.js';
import { PRIMARIES } from '../shared/constants.js';

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
  for (const id of [...POWER_IDS, ...PRIMARIES, 'pistol', 'head']) assert.match(ICONS[id] ?? '', /^<svg viewBox/, id);
});

test('threat bearings run clockwise from straight ahead', () => {
  const eye = { x: 0, z: 0 };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(bearing([0, 0, -5], eye, 0), 0); // yaw 0 looks down -z
  near(bearing([5, 0, 0], eye, 0), Math.PI / 2); // right
  near(Math.abs(bearing([0, 0, 5], eye, 0)), Math.PI); // behind
  near(bearing([-5, 0, 0], eye, Math.PI / 2), 0); // turned left, it is ahead
});
