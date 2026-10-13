import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { SHOT_RANGE } from '../shared/constants.js';

// effects.js imports 'three' as the browser's import map names it.
const three = new URL('./vendor/three.module.js', import.meta.url).href;
register(`data:text/javascript,export const resolve = (s, c, next) => next(s === 'three' ? ${JSON.stringify(three)} : s, c);`);
const fx = await import('./effects.js');
const { cubes, decals, streaks, glows, sparks, dust } = fx.pools;

// A floor (top at y 0), a wall (face at z -10) and a crate (top at y 1.2,
// x 4.4..5.6, z -0.6..0.6).
const MAP = {
  boxes: [
    { pos: [0, -0.5, 0], size: [40, 1, 40], color: 0 },
    { pos: [0, 2, -10.5], size: [20, 4, 1], color: 1 },
    { pos: [5, 0.6, 0], size: [1.2, 1.2, 1.2], color: 3 },
  ],
};
fx.setMap(MAP);

let now = 0;
const frame = () => fx.updateEffects((now += 1000 / 60));
const run = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) frame(); };
const matrix = (mesh, i) => mesh.instanceMatrix.array.subarray(i * 16, i * 16 + 16);
const liveSlots = (mesh) => [...Array(mesh.count).keys()].filter((i) => matrix(mesh, i).some((v) => v !== 0));
const idle = () => cubes.count + streaks.geometry.instanceCount + glows.geometry.instanceCount + sparks.geometry.drawRange.count + dust.geometry.drawRange.count;
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
  // Classified from the muzzle, under the eye: the crate's lip is in the way
  // of the muzzle's ray, not the eye's. The end is still on the wall.
  assert.deepEqual(wall([5, 1.5, 3], [5, 1.3, -10]), ['wall', 0, 0, 1, 1]);
  assert.deepEqual(wall([5, 1.15, 2.5], [5, 1.3, -10]), ['wall', 0, 0, 1, 1]);
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
  assert.equal(live.length, 5); // a rifle round on concrete
  assert.equal(dust.geometry.drawRange.count, 1); // and one puff
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
  assert.equal(cubes.count, 0); // swap-remove: count is the live cubes
  assert.ok(!cubes.visible);
});

test('a voxel thrown up off the crate lands back on it and rests there', () => {
  fx.shatter([{ min: [4.95, 2, -0.05], max: [5.05, 2.1, 0.05] }], '#ff0000'); // one voxel, thrown straight up
  run(2);
  const [i] = liveSlots(cubes);
  const m = matrix(cubes, i);
  assert.ok(Math.abs(m[12] - 5) < 1e-3 && Math.abs(m[14]) < 1e-3, 'it stays over the crate');
  assert.ok(Math.abs(m[13] - (1.2 + column(m, 1) / 2)) < 1e-3, `it rests on the top: y ${m[13]}`);
  run(2);
  assert.equal(cubes.count, 0);
});

test('a casing settles lying down, and sleeps', () => {
  fx.casing([0, 1, 0], [1, 0, 0], 'rifle', [0, 0, 2]);
  run(1.2);
  const [i] = liveSlots(cubes);
  const m = matrix(cubes, i).slice();
  assert.ok(Math.abs(m[9]) / column(m, 2) < 1e-3, 'its long axis is level');
  assert.ok(Math.abs(m[13] - 0.006) < 1e-4, `it lies on the floor: y ${m[13]}`);
  frame();
  assert.deepEqual(matrix(cubes, i), m);
  run(1);
  assert.equal(cubes.count, 0); // gone after 2 s
});

test('bullet holes fill a ring of 256 slots, and fit on their face', () => {
  for (let k = 0; k < 300; k++) fx.impact([k / 30 - 5, 0, 5], [0, 1, 0], 0);
  frame();
  assert.ok(decals.visible);
  assert.equal(liveSlots(decals).length, 256);
  // 1 mm from the crate top's edge there is no room for a hole; 5 cm has
  // room for one at most 10 cm across.
  const before = decals.instanceMatrix.array.slice();
  fx.impact([5, 1.2, 0.599], [0, 1, 0], 2);
  assert.deepEqual(decals.instanceMatrix.array, before);
  fx.impact([5, 1.2, 0.55], [0, 1, 0], 2);
  const changed = [...Array(decals.count).keys()].filter((i) => matrix(decals, i).some((v, k) => v !== before[i * 16 + k]));
  assert.equal(changed.length, 1);
  assert.ok(column(matrix(decals, changed[0]), 0) <= 0.1 + 1e-6);
  run(2);
});

test('every tracer is drawn at least once, and never past where its shot ended', () => {
  const at = streaks.geometry.attributes;
  const head = (i) => at.aB.array.subarray(i * 4, i * 4 + 3);
  run(1);
  fx.addTracer([0, 1.5, 0], [0, 1.5, -2]); // over within one frame at 400 m/s
  frame();
  assert.ok(streaks.visible);
  assert.equal(streaks.geometry.instanceCount, 1);
  assert.deepEqual([...head(0)], [0, 1.5, -2]);
  frame();
  assert.ok(!streaks.visible);
  fx.addTracer([0, 1.5, 0], [0, 1.5, -60]);
  let frames = 0;
  for (frame(); streaks.visible; frame()) {
    frames++;
    assert.ok(head(0)[2] >= -60);
  }
  assert.ok(frames >= 9 && frames <= 11, `${frames} frames`);
});

test('a point-blank shotgun blast spends at most 12 chips and 3 puffs', () => {
  run(3);
  const ends = Array.from({ length: 12 }, (_, k) => [-0.3 + k * 0.05, 1, -10]);
  fx.shot({ from: [0, 1.4, -9], eye: [0, 1.6, -9], ends, weapon: 'shotgun' });
  frame();
  assert.ok(cubes.count <= 12 && cubes.count > 0, `${cubes.count} chips`);
  assert.ok(dust.geometry.drawRange.count <= 3, `${dust.geometry.drawRange.count} puffs`);
  assert.equal(streaks.geometry.instanceCount, 12); // a tracer per pellet
  run(3);
  assert.equal(idle(), 0);
});

test('materials: crates splinter, steel sparks, and a map with materials is followed', () => {
  run(3);
  fx.impact([5, 0.6, -0.6], [0, 0, -1], 2); // the crate (colour 3: plywood)
  frame();
  assert.equal(cubes.count, 4);
  const m = matrix(cubes, 0);
  const sides = [column(m, 0), column(m, 1), column(m, 2)].sort();
  assert.ok(Math.abs(sides[2] / sides[0] - 4) < 0.01, 'a splinter is 4 times as long as it is wide');
  run(2);
  fx.initEffects({ map: { boxes: [{ pos: [0, -0.5, 0], size: [40, 1, 40], color: 0 }], materials: [{ name: 'rust', base: '#8a5a44' }] } });
  fx.impact([0, 0, 0], [0, 1, 0], 0);
  frame();
  assert.equal(cubes.count, 0);
  assert.equal(sparks.geometry.drawRange.count, 6); // sparks, in the sparks pool
  assert.equal(streaks.geometry.instanceCount, 0);
  run(1);
  fx.shot({ from: [0, 1.5, 0], ends: [[0.2, 0, -1], [-0.2, 0, -1]], weapon: 'shotgun' });
  frame();
  assert.equal(streaks.geometry.instanceCount, 2); // a tracer per pellet
  assert.equal(sparks.geometry.drawRange.count, 12); // 6 sparks per pellet, as for any bullet
  run(1);
  // Shotgun fire on rust never eats a blast's ring or smoke.
  fx.blast('shunt', [0, 0.3, -3]);
  frame();
  const blastStreaks = streaks.geometry.instanceCount;
  assert.equal(blastStreaks, 1 + 8); // the ring and 8 puffs
  const pellets = Array.from({ length: 12 }, (_, k) => [-0.3 + k * 0.05, 0, -1]);
  for (let k = 0; k < 4; k++) fx.shot({ from: [0, 1.5, 0], ends: pellets, weapon: 'shotgun' });
  frame();
  assert.equal(streaks.geometry.instanceCount, blastStreaks + 4 * 12, 'the ring and every puff are still live');
  run(2);
  fx.setMap(MAP);
});

test('a puff in the shade of a box is dimmed to skylight; one in the sun is not', () => {
  run(3);
  const map = { boxes: [{ pos: [0, -0.5, 0], size: [40, 1, 40], color: 0 }, { pos: [5, 3, 0], size: [4, 0.2, 4], color: 0 }] };
  fx.initEffects({ map, sunDir: [0, 1, 0] });
  const puff = () => [...dust.geometry.attributes.aColor.array.subarray(0, 3)];
  fx.impact([0, 0, 0], [0, 1, 0], 0);
  frame();
  const sunlit = puff();
  run(1);
  fx.impact([5, 0, 0], [0, 1, 0], 0); // under the roof
  frame();
  const shaded = puff();
  assert.ok(shaded[0] < sunlit[0] * 0.5 && shaded[2] / shaded[0] > sunlit[2] / sunlit[0], 'darker, and bluer');
  run(1);
  fx.initEffects({ map: MAP });
});

test('player hits: cubes in the slot colour plus one white; a Shield gives hexagons instead', () => {
  run(3);
  const target = { id: 3, x: 0, y: 0, z: -5, crouch: false, color: '#e6194b' };
  fx.shot({ from: [0, 1.6, 0], ends: [[0, 1, -4.7]], weapon: 'rifle', targets: [target] });
  frame();
  assert.equal(cubes.count, 5);
  const col = cubes.instanceColor.array;
  const whites = [...Array(5).keys()].filter((i) => col[i * 3 + 1] > 0.85).length;
  assert.equal(whites, 1);
  run(1);
  fx.shot({ from: [0, 1.6, 0], ends: [[0, 1, -4.7]], weapon: 'rifle', targets: [{ ...target, flags: 8 }] });
  frame();
  assert.equal(cubes.count, 0);
  assert.equal(sparks.geometry.drawRange.count, 5);
  run(1);
});

test('a death is at most 120 voxels over the whole body; a headshot sends the helmet off whole', () => {
  run(4);
  const box = (part, c, s) => ({ part, min: c.map((v, a) => v - s[a] / 2), max: c.map((v, a) => v + s[a] / 2) });
  const body = [
    box('thigh', [-0.1, 0.6, 0], [0.17, 0.42, 0.19]), box('thigh', [0.1, 0.6, 0], [0.17, 0.42, 0.19]),
    box('shin', [-0.1, 0.25, 0], [0.14, 0.36, 0.16]), box('shin', [0.1, 0.25, 0], [0.14, 0.36, 0.16]),
    box('torso', [0, 1.1, 0], [0.4, 0.55, 0.26]), box('head', [0, 1.54, 0], [0.26, 0.24, 0.26]),
    box('helmet', [0, 1.735, 0], [0.3, 0.13, 0.3]),
  ];
  fx.deathBurst(body, '#4363d8', [0, 0, -1], false);
  frame();
  const ys = [...Array(cubes.count).keys()].map((i) => matrix(cubes, i)[13]);
  assert.ok(cubes.count <= 120 && cubes.count >= 100, `${cubes.count} voxels`);
  assert.ok(ys.filter((y) => y < 0.8).length >= 20, 'the legs break up too');
  assert.equal(glows.geometry.instanceCount, 0); // nothing additive
  assert.equal(streaks.geometry.instanceCount, 12 + 1); // 12 puffs and the white flash
  run(4);
  fx.deathBurst(body, '#4363d8', [0, 0, -1], true);
  frame();
  const big = [...Array(cubes.count).keys()].filter((i) => column(matrix(cubes, i), 0) > 0.25);
  assert.equal(big.length, 1, 'one helmet-sized cube');
  run(4);
  assert.equal(idle(), 0);
  fx.deathBurst({ x: 0, y: 0, z: -5, crouch: false }, '#4363d8', [0, 0, -1], false); // a player state, as the bible calls it
  frame();
  assert.ok(cubes.count >= 20, `${cubes.count} voxels from its hitboxes`);
  run(4);
});

test('every power-up blast, the fizzle and a pickup spawn, then clear to nothing', () => {
  run(4);
  for (const kind of ['shunt', 'mine', 'barge', 'shock', 'bolt']) fx.blast(kind, [0, 0.3, -3]);
  fx.blast('shunt', [0, 1, -3], 0);
  fx.pickupBurst([0, 1, 0], '#3dff8f');
  fx.pickupBurst([0, 1, 0]); // a kind with no colour
  fx.muzzle([0, 1.4, -2], [0, 0, -1]);
  frame();
  assert.ok(streaks.geometry.instanceCount >= 16 + 4, 'rings, the Barge band, beams and puffs');
  assert.ok(glows.geometry.instanceCount >= 4);
  run(1.5);
  assert.equal(streaks.geometry.instanceCount + glows.geometry.instanceCount + sparks.geometry.drawRange.count, 0);
  run(2);
});

test('a thousand shots reuse the pools: no new objects', () => {
  const children = [...fx.effectsGroup.children];
  const arrays = fx.effectsGroup.children.map((o) => Object.values(o.geometry.attributes).map((a) => a.array));
  for (let k = 0; k < 1000; k++) {
    fx.shot({ from: [0, 1.5, 0], ends: [[0, 1, -10], [0.1, 1, -10]], weapon: 'shotgun' });
    fx.playerHit([0, 1, -5], [0, 0, -1], '#e6194b', k % 2 === 0);
    fx.casing([0, 1.4, 0], [1, 0, 0]);
    if (k % 50 === 0) fx.blast(['shunt', 'barge', 'shock', 'mine'][k % 4], [0, 0.3, -3]);
    frame();
  }
  assert.deepEqual(fx.effectsGroup.children, children);
  assert.deepEqual(fx.effectsGroup.children.map((o) => Object.values(o.geometry.attributes).map((a) => a.array)), arrays);
  run(5);
});

test('a full cube pool steps in well under a frame on the real arena', (t) => {
  fx.setMap(JSON.parse(fs.readFileSync(new URL('../shared/maps/arena_01.json', import.meta.url))));
  for (let k = 0; k < 10; k++) fx.shatter([{ min: [-0.75 + k, 1, -0.75], max: [0.75 + k, 2.5, 0.75] }], 0x808080, [1, 0, 0]);
  for (let k = 0; k < 30; k++) frame(); // let the JIT warm up
  const start = performance.now();
  for (let k = 0; k < 60; k++) frame();
  const ms = (performance.now() - start) / 60;
  assert.equal(cubes.count, 1024);
  t.diagnostic(`${ms.toFixed(3)} ms per update with 1024 live cubes and ${fx.effectsGroup.children.length} pools`);
  assert.ok(ms < 4);
  // Every pool full: still one draw each, and the triangles stay in budget.
  for (let k = 0; k < 300; k++) fx.addTracer([0, 1.5, 0], [0, 1.5, -150]);
  for (let k = 0; k < 70; k++) fx.muzzle([0, 1.5, -3]);
  for (let k = 0; k < 300; k++) fx.impact([k / 30 - 5, 0, 5], [0, 1, 0], 0);
  frame();
  const tris = cubes.count * 12 + decals.count * 2 + (streaks.geometry.instanceCount + glows.geometry.instanceCount) * 2;
  t.diagnostic(`${fx.effectsGroup.children.length} draws, ${tris} triangles with every pool full`);
  assert.equal(fx.effectsGroup.children.length, 6);
  assert.ok(tris <= 16000, `${tris} triangles`);
  run(25);
  assert.equal(idle(), 0, 'count returns to 0 when idle');
});
