// The bible's required power-up and movement tests (docs/bible.md §4.4),
// plus the pure helpers the server builds on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createPowers, stepPowers, falloff, pushScale, domeCentres, lockTarget, padRespawnTicks, NITRO_TICKS, ARENA_LIMIT,
} from './powerups.js';
import { createMover, step, knock, KEY } from './movement.js';
import { prepareMap, overlaps } from './collision.js';
import { decodeClient } from './protocol.js';
import { createArsenal } from './weapons.js';
import { shotRng } from './rng.js';
import { DT, POWER_PADS, POWER_PAD_BOX, POWERS, TICK_RATE } from './constants.js';

const FLOOR = { pos: [0, -0.5, 0], size: [100, 1, 100] };
const world = (...boxes) => prepareMap({ boxes: [FLOOR, ...boxes], spawns: [] }).boxes;
const arena = prepareMap(JSON.parse(await readFile(new URL('./maps/arena_01.json', import.meta.url)))).boxes;
const run = (s, input, boxes, steps) => { for (let i = 0; i < steps; i++) step(s, input, boxes); };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const JUMP_VELOCITY = Math.sqrt(2 * 20 * 1);
// yaw that faces (dx, dz): forward is (-sin yaw, -cos yaw).
const facing = (dx, dz) => Math.atan2(-dx, -dz);

// Steps s until it lands, returning the highest feet height on the way.
function apex(s, input, boxes, max = 240) {
  let top = s.y;
  for (let i = 0; i < max; i++) {
    step(s, input, boxes);
    top = Math.max(top, s.y);
    if (s.grounded) break;
  }
  return top;
}

test('1. a Barge at the apex of a jump off a 1.2 m crate never reaches the 2.4 m pillar tops', () => {
  const boxes = world({ pos: [0, 0.6, 0], size: [4, 1.2, 4] });
  const s = { ...createMover(0, 1.2, 0), grounded: true };
  step(s, { keys: KEY.JUMP, yaw: 0 }, boxes);
  while (s.vy > 0) step(s, { keys: 0, yaw: 0 }, boxes);
  const { knock: push, lift } = POWERS.barge;
  knock(s, push, 0, lift); // the full centre shove
  const top = apex(s, { keys: 0, yaw: 0 }, boxes);
  assert.ok(top <= 2.2 + 1e-9, `apex ${top}`);
});

test('2. a Nitro running jump from the 1.2 m crate toward the pillar never tops 2.2 m', () => {
  const s = { ...createMover(12, 1.2, -2), grounded: true, boost: NITRO_TICKS }; // crate 21
  const yaw = facing(17 - 12, 0 - -2); // pillar 24
  let top = s.y;
  for (let i = 0; i < 120; i++) {
    step(s, { keys: KEY.FORWARD | KEY.JUMP, yaw }, arena);
    top = Math.max(top, s.y);
  }
  assert.ok(top <= 2.2 + 1e-9, `apex ${top}`);
  assert.ok(s.y < 2.4);
});

test('3. a grounded knock with lift 6 peaks at no more than 0.90 m', () => {
  const s = { ...createMover(0, 0, 0), grounded: true };
  knock(s, 0, 0, 6);
  const top = apex(s, { keys: 0, yaw: 0 }, world());
  assert.ok(top <= 0.9 + 1e-9 && top > 0.85, `apex ${top}`);
});

test('4. a knocked player pressing jump within 5 ticks does not jump', () => {
  const s = { ...createMover(0, 0, 0), grounded: true };
  run(s, { keys: 0, yaw: 0 }, world(), 2); // coyote is full
  knock(s, 3, 0, POWERS.shunt.lift / 2 * 0.6); // the weakest lift there is
  const lift = s.vy;
  for (let i = 0; i < 5; i++) {
    step(s, { keys: KEY.JUMP, yaw: 0 }, world());
    assert.ok(s.vy < lift, `tick ${i + 1}: vy ${s.vy}`);
  }
});

test('5. coyote time: a jump in the first 5 airborne ticks after walking off a ledge works, the 6th does not', () => {
  const boxes = world({ pos: [0, 0.6, -5], size: [10, 1.2, 10] }); // edge at z = 0
  const start = () => ({ ...createMover(0, 1.2, -1), grounded: true });
  const fwd = { keys: KEY.FORWARD, yaw: Math.PI }; // toward +z
  const probe = start();
  let walkOff = 0;
  while (probe.grounded) {
    step(probe, fwd, boxes);
    walkOff++;
  }
  const jumpsOn = (k) => { // the k-th step that starts in the air
    const s = start();
    run(s, fwd, boxes, walkOff + k - 1);
    assert.equal(s.grounded, false);
    step(s, { keys: KEY.FORWARD | KEY.JUMP, yaw: Math.PI }, boxes);
    return close(s.vy, JUMP_VELOCITY - 20 * DT);
  };
  for (let k = 1; k <= 5; k++) assert.ok(jumpsOn(k), `airborne tick ${k}`);
  assert.equal(jumpsOn(6), false);
  assert.equal(jumpsOn(7), false);
});

test('6. jump buffer: pressed 6 ticks before landing it fires on landing; 7 ticks before it does not', () => {
  const probe = createMover(0, 2, 0);
  let fall = 0;
  while (!probe.grounded) {
    step(probe, { keys: 0, yaw: 0 }, world());
    fall++;
  }
  const landing = fall + 1; // the first step that starts on the ground
  const jumpsWhenPressed = (k) => {
    const s = createMover(0, 2, 0);
    for (let i = 1; i <= landing; i++) step(s, { keys: i === landing - k ? KEY.JUMP : 0, yaw: 0 }, world());
    return s.vy > 0;
  };
  assert.ok(jumpsWhenPressed(0));
  assert.ok(jumpsWhenPressed(6));
  assert.equal(jumpsWhenPressed(7), false);
});

test('7. Nitro runs at 7.7 m/s, Shock\'s slow at 3.3, both at 4.62; the timers count down once per step', () => {
  for (const [boost, slow, speed] of [[240, 0, 7.7], [0, 120, 3.3], [240, 120, 4.62]]) {
    const s = { ...createMover(0, 0, 0), grounded: true, boost, slow };
    run(s, { keys: KEY.FORWARD, yaw: 0 }, world(), 30);
    assert.ok(close(Math.hypot(s.vx, s.vz), speed), `${boost}/${slow}: ${Math.hypot(s.vx, s.vz)}`);
    assert.deepEqual([s.boost, s.slow], [Math.max(0, boost - 30), Math.max(0, slow - 30)]);
  }
  const s = { ...createMover(0, 0, 0), grounded: true, slow: 3 };
  run(s, { keys: KEY.FORWARD, yaw: 0 }, world(), 5);
  assert.equal(s.slow, 0);
});

test('8. determinism: 600 seeded random inputs, knocks and JSON copies give identical movers', () => {
  const rand = shotRng(7, 3, 11);
  const a = { ...createMover(0, 0, 0), grounded: true };
  let b = structuredClone(a);
  for (let i = 0; i < 600; i++) {
    const input = { keys: Math.floor(rand() * 1024), yaw: (rand() - 0.5) * 7 };
    if (i % 97 === 50) {
      const [x, z, lift] = [rand() * 18 - 9, rand() * 18 - 9, rand() * 6];
      knock(a, x, z, lift);
      knock(b, x, z, lift);
    }
    step(a, input, arena);
    step(b, input, arena);
    if (i % 60 === 0) b = JSON.parse(JSON.stringify(b)); // a snapshot copy, as reconcile gets it
  }
  assert.deepEqual(a, b);
});

test('9. stepPowers: cycle, use, cooldown, gun lock, Bolt shots and the Shield timer', () => {
  const m = createMover(0, 0, 0);
  const arsenal = createArsenal('rifle');
  const pw = createPowers();
  const press = (keys) => stepPowers(pw, m, arsenal, { keys });
  pw.inv = ['shunt', 'mine', 'bolt'];
  assert.equal(press(KEY.CYCLE), null);
  assert.equal(pw.sel, 1);
  press(KEY.CYCLE);
  press(KEY.CYCLE);
  assert.equal(pw.sel, 0); // wraps
  pw.sel = 2;
  assert.equal(press(KEY.USE), 'bolt'); // the selected item, popped
  assert.deepEqual([pw.inv, pw.sel], [['shunt', 'mine'], 1]); // sel clamped
  assert.ok(close(arsenal.switching, 0.55));

  // Bolt fires on ticks 0, 15 and 30, and blocks using anything meanwhile.
  const shots = [0];
  for (let t = 1; t <= 45; t++) if (press(KEY.USE) === 'bolt') shots.push(t);
  assert.deepEqual(shots, [0, 15, 30]);
  assert.deepEqual(pw.inv, ['shunt', 'mine']);

  // A 60-tick cooldown between uses.
  const used = createPowers();
  used.inv = ['mine', 'mine'];
  const a2 = createArsenal('rifle');
  assert.equal(stepPowers(used, m, a2, { keys: KEY.USE }), 'mine');
  assert.ok(close(a2.switching, 0.25));
  for (let t = 1; t < 60; t++) assert.equal(stepPowers(used, m, a2, { keys: KEY.USE }), null, `tick ${t}`);
  assert.equal(stepPowers(used, m, a2, { keys: KEY.USE }), 'mine');

  // Nitro starts the mover's boost; the Shield expires after 480 ticks.
  const s = createPowers();
  s.inv = ['shield', 'nitro'];
  assert.equal(stepPowers(s, m, a2, { keys: KEY.USE }), 'shield');
  assert.equal(s.shield, 60);
  for (let t = 1; t < 480; t++) stepPowers(s, m, a2, { keys: 0 });
  assert.equal(s.shield, 60);
  stepPowers(s, m, a2, { keys: 0 });
  assert.equal(s.shield, 0);
  assert.equal(stepPowers(s, m, a2, { keys: KEY.USE }), 'nitro');
  assert.equal(m.boost, NITRO_TICKS);
  assert.equal(stepPowers(createPowers(), m, a2, { keys: KEY.USE }), null); // nothing held
});

test('10. an input with k = 768 (USE | CYCLE) decodes', () => {
  const m = decodeClient(JSON.stringify({ t: 'input', s: 1, rt: 0, k: 768, y: 0, p: 0, f: 0, n: 0, w: 0 }));
  assert.equal(m.keys, KEY.USE | KEY.CYCLE);
});

test('splash falls from max to min across the radius; knocks from 1 to 0.6', () => {
  assert.equal(falloff(0, 2.5, 40, 10), 40);
  assert.equal(falloff(1.25, 2.5, 40, 10), 25);
  assert.equal(falloff(2.5, 2.5, 40, 10), 0);
  assert.equal(pushScale(0, 5), 1);
  assert.ok(close(pushScale(5, 5), 0.6));
});

test('Shock domes lead the target by 1.2, 1.6 and 2.0 s and stay in the arena', () => {
  assert.deepEqual(domeCentres(0, 0, 0, 5, 0).map(([x]) => Math.round(x * 100) / 100), [6, 8, 10]);
  assert.deepEqual(domeCentres(15, 1.2, -15, 5, -5).map(([x, y, z]) => [x, y, z]), Array(3).fill([ARENA_LIMIT, 1.2, -ARENA_LIMIT]));
});

test('a Shunt locks on the enemy nearest the crosshair, in range and in sight', () => {
  const eye = [0, 1.6, 0];
  const dir = [0, 0, -1];
  const near = { id: 1, x: 3, y: 0, z: -10, crouch: false }; // 16.7° off
  const ahead = { id: 2, x: 0.5, y: 0, z: -20, crouch: false };
  const wide = { id: 3, x: 10, y: 0, z: -10, crouch: false }; // 45° off
  const far = { id: 4, x: 0, y: 0, z: -45, crouch: false };
  assert.equal(lockTarget(eye, dir, [near, ahead, wide, far], world()), 2);
  assert.equal(lockTarget(eye, dir, [wide, far], world()), null);
  const wall = world({ pos: [0, 2, -15], size: [4, 4, 1] });
  assert.equal(lockTarget(eye, dir, [near, ahead], wall), 1); // the nearer one is hidden
});

test('pads refill at the 6-player rate, slower in smaller games', () => {
  const pad = { respawn: 30 };
  assert.equal(padRespawnTicks(pad, 6), 30 * TICK_RATE);
  assert.equal(padRespawnTicks(pad, 10), 30 * TICK_RATE);
  assert.equal(padRespawnTicks(pad, 3), 60 * TICK_RATE);
  assert.equal(padRespawnTicks(pad, 0), 180 * TICK_RATE);
});

test('every pad\'s pickup box stands clear of the map', () => {
  const [w, h, d] = POWER_PAD_BOX;
  for (const { pos: [x, y, z], pool } of POWER_PADS) {
    assert.ok(pool.every((k) => k in POWERS), `${pool}`);
    assert.ok(!overlaps({ x, y, z }, w / 2, h, arena), `pad at ${x}, ${y}, ${z}`);
    assert.ok(overlaps({ x, y: y - 0.01, z }, w / 2, 0.02, arena), `pad at ${x}, ${y}, ${z} stands on something`);
  }
  assert.equal(w, d);
});
