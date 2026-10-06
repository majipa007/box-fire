import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PADS, onPad, stepPowerups, knock } from './powerups.js';
import { createMover, step, KEY } from './movement.js';
import { prepareMap, overlaps } from './collision.js';
import { POWERUPS, PLAYER_WIDTH, STAND_HEIGHT, PICKUP_RADIUS, RUN_SPEED } from './constants.js';

const floor = prepareMap({ boxes: [{ pos: [0, -0.5, 0], size: [100, 1, 100] }], spawns: [] }).boxes;
const idle = { keys: 0, yaw: 0 };
const run = (s, input, boxes, steps) => { for (let i = 0; i < steps; i++) step(s, input, boxes); };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const grounded = () => {
  const s = createMover(0, 0, 0);
  run(s, idle, floor, 2);
  return s;
};

test('cycle sends the first power-up to the back; use takes the first', () => {
  const inv = ['shunt', 'mine', 'bolt'];
  const m = createMover(0, 0, 0);
  assert.equal(stepPowerups(inv, m, KEY.CYCLE), null);
  assert.deepEqual(inv, ['mine', 'bolt', 'shunt']);
  assert.equal(stepPowerups(inv, m, KEY.USE), 'mine');
  assert.deepEqual(inv, ['bolt', 'shunt']);
  assert.equal(stepPowerups(inv, m, KEY.CYCLE | KEY.USE), 'shunt'); // cycles, then uses
  assert.deepEqual(inv, ['bolt']);
  assert.equal(stepPowerups(inv, m, KEY.FORWARD | KEY.JUMP | KEY.RELOAD), null);
  assert.equal(stepPowerups(inv, m, KEY.CYCLE), null); // one power-up: nothing to cycle
  assert.deepEqual(inv, ['bolt']);
  assert.equal(stepPowerups([], m, KEY.USE), null);
});

test('Nitro starts on the step it is used and runs 1.6x as fast until it wears off', () => {
  const s = grounded();
  assert.equal(stepPowerups(['nitro', 'mine'], s, KEY.USE), 'nitro');
  assert.equal(s.boost, POWERUPS.nitro.seconds);
  run(s, { keys: KEY.FORWARD, yaw: 0 }, floor, 60);
  assert.ok(close(Math.hypot(s.vx, s.vz), RUN_SPEED * POWERUPS.nitro.speed));
  run(s, { keys: KEY.FORWARD, yaw: 0 }, floor, POWERUPS.nitro.seconds * 60 - 60 + 1);
  assert.equal(s.boost, 0);
  run(s, { keys: KEY.FORWARD, yaw: 0 }, floor, 30);
  assert.ok(close(Math.hypot(s.vx, s.vz), RUN_SPEED));
});

test('a knockback slides the player and bleeds off to exactly zero on the ground', () => {
  const s = grounded();
  knock(s, 2, 0, 10, 0); // direction need not be unit length
  assert.deepEqual([s.kx, s.kz], [10, 0]);
  step(s, idle, floor);
  assert.ok(close(s.x, 10 / 60), `x=${s.x}`);
  run(s, idle, floor, 60);
  assert.deepEqual([s.kx, s.kz], [0, 0]);
  assert.ok(s.x > 1.5 && s.x < 1.9, `slid ${s.x} m`); // v² / 2a = 1.67 m at 30 m/s²
  assert.equal(s.vx, 0); // input velocity untouched
});

test('a knockback with lift throws the player and carries much further', () => {
  const ground = grounded();
  knock(ground, 1, 0, 10, 0);
  run(ground, idle, floor, 120);
  const air = grounded();
  knock(air, 1, 0, 10, 6);
  assert.equal(air.grounded, false);
  step(air, idle, floor);
  assert.ok(air.y > 0);
  run(air, idle, floor, 120);
  assert.equal(air.grounded, true);
  assert.ok(air.x > ground.x * 2, `air ${air.x} vs ground ${ground.x}`);
});

test('a wall stops a knockback dead', () => {
  const boxes = prepareMap({ boxes: [{ pos: [0, -0.5, 0], size: [100, 1, 100] }, { pos: [2, 1.5, 0], size: [1, 3, 10] }], spawns: [] }).boxes;
  const s = createMover(0, 0, 0);
  run(s, idle, boxes, 2);
  knock(s, 1, 0, 20, 0);
  run(s, idle, boxes, 30);
  assert.ok(close(s.x, 1.5 - PLAYER_WIDTH / 2), `x=${s.x}`);
  assert.deepEqual([s.kx, s.kz], [0, 0]);
});

test('a mover copied through JSON replays bit-identically with boost and knockback', () => {
  // Reconcile copies the server's mover from JSON and replays inputs on it.
  const a = grounded();
  a.boost = 2;
  knock(a, 1, 0.5, 12, 5);
  const inputs = Array.from({ length: 90 }, (_, i) => ({ keys: i % 20 < 10 ? KEY.FORWARD : KEY.LEFT | KEY.JUMP, yaw: i * 0.01 }));
  run(a, inputs[0], floor, 1);
  const b = JSON.parse(JSON.stringify(a));
  for (const input of inputs) {
    step(a, input, floor);
    step(b, input, floor);
  }
  assert.deepEqual(b, a);
});

test('a pad is collected standing on it or jumping through it, not from beside it', () => {
  assert.ok(onPad({ x: 0.5, y: 0, z: 0.5 }, 0, 0, 0));
  assert.ok(onPad({ x: 0, y: 1.2, z: 0 }, 0, 0, 0));
  assert.ok(!onPad({ x: PICKUP_RADIUS, y: 0, z: 0.2 }, 0, 0, 0));
  assert.ok(!onPad({ x: 0, y: 2, z: 0 }, 0, 0, 0));
  assert.ok(!onPad({ x: 0, y: -1, z: 0 }, 0, 0, 0));
});

test('every pad sits on open floor, clear of the boxes and at least 5 m from any spawn', async () => {
  for (const [mapId, pads] of Object.entries(PADS)) {
    const map = prepareMap(JSON.parse(await readFile(new URL(`./maps/${mapId}.json`, import.meta.url))));
    for (const [x, y, z, kind] of pads) {
      const where = `${mapId} ${kind} at ${x}, ${z}`;
      assert.ok(kind in POWERUPS, where);
      assert.ok(!overlaps({ x, y, z }, PICKUP_RADIUS, STAND_HEIGHT, map.boxes), `${where} overlaps a box`);
      const dropped = createMover(x, y + 0.5, z);
      run(dropped, idle, map.boxes, 60);
      assert.equal(dropped.y, y, `${where} has no floor under it`);
      for (const [sx, , sz] of map.spawns) assert.ok(Math.hypot(sx - x, sz - z) >= 5, `${where} is near the spawn ${sx}, ${sz}`);
    }
  }
});
