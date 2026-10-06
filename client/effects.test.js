import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { SHOT_RANGE } from '../shared/constants.js';

// effects.js imports 'three' as the browser's import map names it.
const three = new URL('./vendor/three.module.js', import.meta.url).href;
register(`data:text/javascript,export const resolve = (s, c, next) => next(s === 'three' ? ${JSON.stringify(three)} : s, c);`);
const fx = await import('./effects.js');
const { cubes, decals, tracers } = fx.pools;

// A floor (top at y 0), a wall (face at z -10) and a crate (top at y 1.2,
// x 4.4..5.6, z -0.6..0.6).
fx.setMap({
  boxes: [
    { pos: [0, -0.5, 0], size: [40, 1, 40], color: 0 },
    { pos: [0, 2, -10.5], size: [20, 4, 1], color: 1 },
    { pos: [5, 0.6, 0], size: [1.2, 1.2, 1.2], color: 3 },
  ],
});

let now = 0;
const frame = () => fx.updateEffects((now += 1000 / 60));
const run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) frame(); };
const matrix = (mesh, i) => mesh.instanceMatrix.array.subarray(i * 16, i * 16 + 16);
const liveSlots = (mesh) => [...Array(mesh.count).keys()].filter((i) => matrix(mesh, i).some((v) => v !== 0));
const column = (m, c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);

test('a shot ending on a map face is a wall hit, with the face it entered', () => {
  const eye = [0, 1.6, 0];
  const wall = (o, end) => {
    const hit = fx.classifyHit(o, end, []);
    return [hit.kind, ...hit.normal, hit.surface];
  };
  assert.deepEqual(wall(eye, [0, 0, -3]), ['wall', 0, 1, 0, 0]);
  assert.deepEqual(wall(eye, [1, 1.2, -10]), ['wall', 0, 0, 1, 1]);
  // Ends arrive rounded to 1 mm.
  assert.deepEqual(wall(eye, [0.3, 1.5, -10.001]), ['wall', 0, 0, 1, 1]);
  // The crate's top just in from its edge, and its side just under that edge.
  assert.deepEqual(wall([0, 1.8, 0], [4.45, 1.2, 0]), ['wall', 0, 1, 0, 2]);
  assert.deepEqual(wall([0, 1.8, 0], [4.4, 1.15, 0]), ['wall', -1, 0, 0, 2]);
});

test('a shot ending off the map is a player hit, matched by hitboxes(), or a miss at full range', () => {
  const eye = [0, 1.6, 0];
  const players = [{ id: 7, x: 0, y: 0, z: -5, crouch: false }, { id: 9, x: 3, y: 0, z: -5, crouch: false }];
  const who = (end, list = players) => {
    const hit = fx.classifyHit(eye, end, list);
    return [hit.kind, hit.id, hit.head];
  };
  assert.deepEqual(who([0, 1.65, -4.85]), ['player', 7, true]);
  assert.deepEqual(who([0, 1, -4.7]), ['player', 7, false]);
  // The server hit them where the shooter saw them, 0.3 m from where we draw them.
  assert.deepEqual(who([0, 1, -4.7], [{ id: 7, x: 0, y: 0, z: -5.3, crouch: false }]), ['player', 7, false]);
  assert.deepEqual(who([0, 1, -4.7], []), ['player', null, false]);
  assert.equal(fx.classifyHit(eye, [0, 1.6 + SHOT_RANGE * Math.sin(0.5), -SHOT_RANGE * Math.cos(0.5)], players).kind, 'none');
});

test('chips fly off a wall and fall, never sinking into the wall or the floor, then are freed', () => {
  run(5);
  fx.impact([0, 1, -10], [0, 0, 1], 1);
  frame();
  assert.ok(cubes.visible);
  const live = liveSlots(cubes);
  assert.equal(live.length, 4);
  for (let t = 0; t < 2; t += 1 / 60) {
    frame();
    for (const i of live) {
      const m = matrix(cubes, i);
      if (!m.some((v) => v !== 0)) continue;
      const half = column(m, 0) / 2; // chips are cubes
      assert.ok(m[13] >= half - 1e-3, `chip ${i} sank into the floor: y ${m[13]}`);
      assert.ok(m[14] >= -10 + half - 1e-3, `chip ${i} sank into the wall: z ${m[14]}`);
    }
  }
  assert.equal(liveSlots(cubes).length, 0);
  assert.ok(!cubes.visible);
});

test('a voxel thrown up off the crate lands back on it and rests there', () => {
  fx.shatter([{ min: [4.925, 2, -0.075], max: [5.075, 2.15, 0.075] }], '#ff0000');
  run(2);
  const [i] = liveSlots(cubes);
  const m = matrix(cubes, i);
  assert.ok(Math.abs(m[12] - 5) < 1e-3 && Math.abs(m[14]) < 1e-3, 'it stays over the crate');
  assert.ok(Math.abs(m[13] - (1.2 + column(m, 1) / 2)) < 1e-3, `it rests on the top: y ${m[13]}`);
  run(2);
  assert.equal(liveSlots(cubes).length, 0);
});

test('a casing settles lying down, and sleeps', () => {
  fx.casing([0, 1, 0], [1, 0, 0], [0, 0, 2]);
  run(2.5);
  const [i] = liveSlots(cubes);
  const m = matrix(cubes, i).slice();
  assert.ok(Math.abs(m[9]) / column(m, 2) < 1e-3, 'its long axis is level');
  assert.ok(Math.abs(m[13] - 0.006) < 1e-4, `it lies on the floor: y ${m[13]}`);
  frame();
  assert.deepEqual(matrix(cubes, i), m);
  run(2);
});

test('bullet holes fill a ring of 256 slots, and fit on their face', () => {
  for (let k = 0; k < 300; k++) fx.impact([k / 30 - 5, 0, 5], [0, 1, 0], 0);
  frame();
  assert.ok(decals.visible);
  assert.equal(liveSlots(decals).length, 256);
  // 1 cm from the crate top's edge there is no room for a hole; 3 cm has room
  // for a small one.
  const before = decals.instanceMatrix.array.slice();
  fx.impact([5, 1.2, 0.59], [0, 1, 0], 2);
  assert.deepEqual(decals.instanceMatrix.array, before);
  fx.impact([5, 1.2, 0.57], [0, 1, 0], 2);
  const changed = [...Array(decals.count).keys()].filter((i) => matrix(decals, i).some((v, k) => v !== before[i * 16 + k]));
  assert.equal(changed.length, 1);
  assert.ok(column(matrix(decals, changed[0]), 0) <= 0.06 + 1e-6);
  run(2);
});

test('every tracer is drawn at least once, and never past where its shot ended', () => {
  const live = () => [...Array(128).keys()].filter((i) => tracers.geometry.attributes.aTail.array[i * 4 + 3] > 0);
  const head = (i) => tracers.geometry.attributes.aHead.array.subarray(i * 4, i * 4 + 3);
  run(1);
  fx.addTracer([0, 1.5, 0], [0, 1.5, -2]); // over within one frame at 400 m/s
  frame();
  assert.ok(tracers.visible);
  const [i] = live();
  assert.deepEqual([...head(i)], [0, 1.5, -2]);
  frame();
  assert.ok(!tracers.visible);
  fx.addTracer([0, 1.5, 0], [0, 1.5, -60]);
  let frames = 0;
  for (frame(); tracers.visible; frame()) {
    frames++;
    for (const j of live()) assert.ok(head(j)[2] >= -60);
  }
  assert.ok(frames >= 9 && frames <= 11, `${frames} frames`);
});

test('a thousand shots reuse the pools: no new objects', () => {
  const children = [...fx.effectsGroup.children];
  const arrays = fx.effectsGroup.children.map((o) => Object.values(o.geometry.attributes).map((a) => a.array));
  for (let k = 0; k < 1000; k++) {
    fx.addTracer([0, 1.5, 0], [0, 1, -9]);
    fx.impact([0, 1, -10], [0, 0, 1], 1, 0.3);
    fx.playerHit([0, 1, -5], [0, 0, -1], '#e6194b', k % 2 === 0, 0.3);
    fx.casing([0, 1.4, 0], [1, 0, 0]);
    frame();
  }
  assert.deepEqual(fx.effectsGroup.children, children);
  assert.deepEqual(fx.effectsGroup.children.map((o) => Object.values(o.geometry.attributes).map((a) => a.array)), arrays);
  run(5);
});

test('a full cube pool steps in well under a frame on the real arena', (t) => {
  fx.setMap(JSON.parse(fs.readFileSync(new URL('../shared/maps/arena_01.json', import.meta.url))));
  for (let k = 0; k < 6; k++) fx.shatter([{ min: [-0.75 + k, 1, -0.75], max: [0.75 + k, 2.5, 0.75] }], 0x808080, [1, 0, 0]);
  for (let k = 0; k < 30; k++) frame(); // let the JIT warm up
  const start = performance.now();
  for (let k = 0; k < 60; k++) frame();
  const ms = (performance.now() - start) / 60;
  assert.equal(liveSlots(cubes).length, 1024);
  t.diagnostic(`${ms.toFixed(3)} ms per update with 1024 live cubes and ${fx.effectsGroup.children.length} pools`);
  assert.ok(ms < 4);
});
