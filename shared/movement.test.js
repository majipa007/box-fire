import test from 'node:test';
import assert from 'node:assert/strict';
import { step, createMover, KEY } from './movement.js';
import { prepareMap } from './collision.js';

const floor = { pos: [0, -0.5, 0], size: [100, 1, 100] };
const world = (...boxes) => prepareMap({ boxes: [floor, ...boxes], spawns: [] }).boxes;
const run = (s, input, boxes, steps) => { for (let i = 0; i < steps; i++) step(s, input, boxes); };

test('a player dropped above the floor falls and lands on it', () => {
  const s = createMover(0, 2, 0);
  run(s, { keys: 0, yaw: 0 }, world(), 120);
  assert.equal(s.y, 0);
  assert.equal(s.vy, 0);
  assert.equal(s.grounded, true);
});

test('holding forward runs at 5.5 m/s in the facing direction', () => {
  const s = createMover(0, 0, 0);
  const input = { keys: KEY.FORWARD, yaw: 0 }; // yaw 0 faces -z
  run(s, input, world(), 60);
  const z0 = s.z;
  run(s, input, world(), 60);
  assert.ok(Math.abs(z0 - s.z - 5.5) < 1e-9, `covered ${z0 - s.z} m in 1 s`);
  assert.ok(Math.abs(s.x) < 1e-9);

  const side = createMover(0, 0, 0);
  run(side, { keys: KEY.RIGHT, yaw: Math.PI / 2 }, world(), 120); // facing -x, right is -z
  assert.ok(Math.abs(Math.hypot(side.vx, side.vz) - 5.5) < 1e-9);
  assert.ok(side.vz < 0 && Math.abs(side.vx) < 1e-9);
});

test('a wall stops the player at its face, and diagonal input slides along it', () => {
  const boxes = world({ pos: [0, 1.5, -3], size: [10, 3, 1] }); // face at z = -2.5
  const s = createMover(0, 0, 0);
  run(s, { keys: KEY.FORWARD, yaw: 0 }, boxes, 120);
  assert.ok(Math.abs(s.z - -2.2) < 1e-9, `stopped at z=${s.z}`); // 0.3 m half width
  run(s, { keys: KEY.FORWARD | KEY.RIGHT, yaw: 0 }, boxes, 60);
  assert.ok(Math.abs(s.z - -2.2) < 1e-9);
  assert.ok(s.x > 3, `slid to x=${s.x}`);
});

test('a jump rises about 1 m and lands again', () => {
  const s = createMover(0, 0, 0);
  run(s, { keys: 0, yaw: 0 }, world(), 2);
  step(s, { keys: KEY.JUMP, yaw: 0 }, world());
  let top = s.y;
  for (let i = 0; i < 60; i++) {
    step(s, { keys: 0, yaw: 0 }, world());
    top = Math.max(top, s.y);
  }
  assert.ok(top > 0.99 && top <= 1.0, `apex ${top}`);
  assert.equal(s.y, 0);
  assert.equal(s.grounded, true);
});

test('jump only works from the ground', () => {
  const s = createMover(0, 3, 0); // falling
  step(s, { keys: KEY.JUMP, yaw: 0 }, world());
  assert.ok(s.vy < 0);
});

test('in the air, input steers at 20% of ground control and momentum carries', () => {
  const ground = createMover(0, 0, 0);
  run(ground, { keys: 0, yaw: 0 }, world(), 2);
  run(ground, { keys: KEY.RIGHT, yaw: 0 }, world(), 3);

  const air = createMover(0, 0, 0);
  run(air, { keys: 0, yaw: 0 }, world(), 2);
  step(air, { keys: KEY.JUMP, yaw: 0 }, world());
  run(air, { keys: KEY.RIGHT, yaw: 0 }, world(), 3);
  assert.ok(Math.abs(Math.hypot(air.vx, air.vz) - 0.2 * Math.hypot(ground.vx, ground.vz)) < 1e-9);

  const coast = createMover(0, 0, 0);
  run(coast, { keys: KEY.FORWARD, yaw: 0 }, world(), 60);
  step(coast, { keys: KEY.FORWARD | KEY.JUMP, yaw: 0 }, world());
  run(coast, { keys: 0, yaw: 0 }, world(), 20);
  assert.equal(coast.grounded, false);
  assert.ok(Math.abs(Math.hypot(coast.vx, coast.vz) - 5.5) < 1e-9);
});

test('air strafing never gains speed', () => {
  const s = createMover(0, 0, 0);
  run(s, { keys: KEY.FORWARD, yaw: 0 }, world(), 60);
  step(s, { keys: KEY.FORWARD | KEY.JUMP, yaw: 0 }, world());
  for (let i = 1; i <= 30; i++) {
    step(s, { keys: KEY.FORWARD | KEY.RIGHT, yaw: -0.05 * i }, world());
    assert.ok(Math.hypot(s.vx, s.vz) <= 5.5 + 1e-9);
  }
});

test('falling fast never tunnels through a thin plate', () => {
  const plate = prepareMap({ boxes: [{ pos: [0, -10, 0], size: [4, 0.05, 4] }], spawns: [] }).boxes;
  const s = createMover(0, 50, 0); // ~35 m/s at impact, 0.58 m per step
  run(s, { keys: 0, yaw: 0 }, plate, 240);
  assert.ok(Math.abs(s.y - -9.975) < 1e-9, `ended at y=${s.y}`);
});

// Hop forward every time we touch the ground, for up to 3 s or until standing
// at `targetY`, then settle.
function hopForward(s, yaw, boxes, targetY) {
  for (let i = 0; i < 180 && !(s.grounded && s.y >= targetY); i++) {
    step(s, { keys: KEY.FORWARD | (s.grounded ? KEY.JUMP : 0), yaw }, boxes);
  }
  run(s, { keys: 0, yaw }, boxes, 30);
}

test('a 0.75 m ledge can be jumped onto; a 1.2 m one cannot', () => {
  const low = createMover(0, 0, 0);
  hopForward(low, 0, world({ pos: [0, 0.375, -6], size: [4, 0.75, 6] }), 0.75); // face at z = -3
  assert.equal(low.y, 0.75);

  const high = createMover(0, 0, 0);
  hopForward(high, 0, world({ pos: [0, 0.6, -6], size: [4, 1.2, 6] }), 1.2);
  assert.equal(high.y, 0);
  assert.ok(Math.abs(high.z - -2.7) < 1e-9);
});

test('the arena platform is reached over its step crate, not by jumping at its face', async () => {
  const { readFile } = await import('node:fs/promises');
  const arena = prepareMap(JSON.parse(await readFile(new URL('./maps/arena_01.json', import.meta.url)))).boxes;
  const viaCrate = createMover(0, 0, 8);
  hopForward(viaCrate, Math.PI, arena, 1.2); // yaw π faces +z, toward the platform
  assert.equal(viaCrate.y, 1.2);

  const direct = createMover(2.5, 0, 8); // beside the crate
  hopForward(direct, Math.PI, arena, 1.2);
  assert.equal(direct.y, 0);
});

test('releasing the keys on the ground stops the player quickly', () => {
  const s = createMover(0, 0, 0);
  run(s, { keys: KEY.FORWARD, yaw: 0 }, world(), 60);
  run(s, { keys: 0, yaw: 0 }, world(), 12); // 0.2 s
  assert.equal(Math.hypot(s.vx, s.vz), 0);
});
