import test from 'node:test';
import assert from 'node:assert/strict';
import { createArsenal, stepWeapon, traceShot, spreadDegrees, shotDirs, aimDir, damageAt, freshLife } from './weapons.js';
import { KEY } from './movement.js';
import { prepareMap } from './collision.js';
import { shotRng } from './rng.js';

const mover = (speed, extra = {}) => ({ x: 0, y: 0, z: 0, vx: speed, vy: 0, vz: 0, grounded: true, crouch: false, ...extra });
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('rifle spread blends from 0.15° standing to 2.5° at run speed', () => {
  assert.ok(close(spreadDegrees('rifle', mover(0)), 0.15));
  assert.ok(close(spreadDegrees('rifle', mover(5.5)), 2.5));
  assert.ok(close(spreadDegrees('rifle', mover(2.75)), 1.325));
});

test('airborne spread is double the moving value, crouched is 0.8 of standing', () => {
  assert.ok(close(spreadDegrees('rifle', mover(0, { grounded: false })), 5));
  assert.ok(close(spreadDegrees('rifle', mover(1.8, { crouch: true })), 0.12));
});

test('seeded shot directions stay inside the spread cone and repeat exactly', () => {
  const m = mover(5.5); // 2.5° rifle spread
  const aim = aimDir(0.3, 0.1);
  for (let shot = 1; shot <= 200; shot++) {
    const [d] = shotDirs(0.3, 0.1, 'rifle', m, shotRng(42, 1, shot));
    const angle = (Math.acos(Math.min(1, d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2])) * 180) / Math.PI;
    assert.ok(angle <= 2.5 + 1e-9, `shot ${shot} strayed ${angle}°`);
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12, 'unit length');
  }
  assert.deepEqual(shotDirs(0.3, 0.1, 'rifle', m, shotRng(42, 1, 9)), shotDirs(0.3, 0.1, 'rifle', m, shotRng(42, 1, 9)));
});

const ahead = [0, 0, -1];
const target = (id, z, crouch = false) => ({ id, x: 0, y: 0, z, crouch });

test('a shot hits the head of a standing player at eye height, the body lower down', () => {
  const head = traceShot([0, 1.6, 0], ahead, [], [target(2, -10)]);
  assert.deepEqual([head.id, head.head], [2, true]);
  assert.ok(Math.abs(head.t - 9.85) < 1e-9); // head front face
  const body = traceShot([0, 1, 0], ahead, [], [target(2, -10)]);
  assert.deepEqual([body.id, body.head], [2, false]);
  assert.equal(traceShot([0, 1.9, 0], ahead, [], [target(2, -10)]).id, null); // over the head
});

test('a crouched player is only 1.2 m tall', () => {
  assert.equal(traceShot([0, 1.6, 0], ahead, [], [target(2, -10, true)]).id, null);
  assert.equal(traceShot([0, 1.0, 0], ahead, [], [target(2, -10, true)]).head, true);
});

test('walls block shots, and the nearest player is the one hit', () => {
  const wall = prepareMap({ boxes: [{ pos: [0, 1.5, -5], size: [4, 3, 0.5] }], spawns: [] }).boxes;
  const blocked = traceShot([0, 1.6, 0], ahead, wall, [target(2, -10)]);
  assert.equal(blocked.id, null);
  assert.ok(Math.abs(blocked.t - 4.75) < 1e-9); // the wall face
  assert.equal(traceShot([0, 1, 0], ahead, [], [target(2, -10), target(3, -6)]).id, 3);
});

const hold = { keys: 0, fire: true, slot: 0 };
const idle = { keys: 0, fire: false, slot: 0 };
const shots = (a, input, steps) => {
  let n = 0;
  for (let i = 0; i < steps; i++) if (stepWeapon(a, input)) n++;
  return n;
};

test('holding the trigger fires the rifle at 9.75 shots per second on average', () => {
  const a = createArsenal('rifle');
  a.mags[0] = 1000; // never run dry here
  assert.equal(stepWeapon(a, hold), true, 'the first shot is immediate');
  const n = 1 + shots(a, hold, 599); // 10 s
  assert.ok(n === 97 || n === 98, `${n} shots in 10 s`);
});

test('releasing the trigger does not bank shots for a burst later', () => {
  const a = createArsenal('rifle');
  a.mags[0] = 1000;
  shots(a, hold, 30);
  shots(a, idle, 60); // let go for a second
  assert.equal(shots(a, hold, 6), 1, 'one shot per 6.15 steps, not a burst');
});

test('the rifle runs dry after 25 shots; firing on empty reloads it in 2.5 s', () => {
  const a = createArsenal('rifle');
  assert.equal(shots(a, hold, 300), 25);
  assert.equal(a.mags[0], 0);
  assert.ok(a.reload > 0, 'pulling on empty started a reload');
  const left = Math.round(a.reload * 60);
  assert.equal(shots(a, hold, left - 1), 0, 'no shots while reloading');
  assert.equal(shots(a, idle, 1), 0);
  assert.equal(a.mags[0], 25);
  assert.equal(shots(a, hold, 1), 1);
});

const pistol = (fire) => ({ keys: 0, fire, slot: 1 });

test('the pistol fires once per click, never on a held trigger', () => {
  const a = createArsenal('rifle');
  shots(a, pistol(false), 30); // switch to the pistol and let the switch finish
  assert.equal(shots(a, pistol(true), 120), 1, 'holding fires one shot');
});

test('clicking as fast as possible is capped at 6.75 pistol shots per second', () => {
  const a = createArsenal('rifle');
  shots(a, pistol(false), 30);
  a.mags[1] = 1000;
  let n = 0;
  for (let i = 0; i < 600; i++) if (stepWeapon(a, pistol(i % 2 === 0))) n++; // a click every other step
  assert.ok(n === 67 || n === 68, `${n} shots in 10 s`);
});

test('switching weapons blocks firing for 0.4 s and cancels a reload', () => {
  const a = createArsenal('rifle');
  shots(a, pistol(false), 30); // draw the pistol
  shots(a, pistol(true), 1);
  stepWeapon(a, { ...pistol(false), keys: KEY.RELOAD }); // start reloading the pistol
  assert.ok(a.reload > 0);
  let steps = 0;
  while (!stepWeapon(a, hold) && steps < 100) steps++; // switch to the rifle, trigger held
  assert.equal(steps, 24, 'the first rifle shot comes 0.4 s after the switch');
  assert.equal(a.mags[1], 11, 'the pistol reload was cancelled');
});

test('each weapon keeps its own magazine', () => {
  const a = createArsenal('rifle');
  shots(a, hold, 30); // 5 rifle shots
  shots(a, pistol(false), 30);
  shots(a, pistol(true), 1);
  shots(a, idle, 30); // back to the rifle
  assert.deepEqual(a.mags, [20, 11]);
});

test('the shotgun fires 12 pellets inside a 3.5° cone, standing or running', () => {
  for (const speed of [0, 5.5]) {
    let widest = 0;
    for (let shot = 1; shot <= 50; shot++) {
      const dirs = shotDirs(0, 0, 'shotgun', mover(speed), shotRng(7, 1, shot));
      assert.equal(dirs.length, 12);
      for (const d of dirs) widest = Math.max(widest, (Math.acos(Math.min(1, -d[2])) * 180) / Math.PI);
    }
    assert.ok(widest <= 3.5 + 1e-9 && widest > 3.3, `widest pellet ${widest}°`);
  }
});

test('the shotgun pumps at 1.1 shots per second and holds 5 shells', () => {
  const a = createArsenal('shotgun');
  let n = 0;
  for (let i = 0; i < 600 && a.mags[0] > 0; i++) if (stepWeapon(a, { ...hold, fire: i % 2 === 0 })) n++;
  assert.equal(n, 5);
  const b = createArsenal('shotgun');
  b.mags[0] = 1000;
  let m = 0;
  for (let i = 0; i < 600; i++) if (stepWeapon(b, { ...hold, fire: i % 2 === 0 })) m++;
  assert.ok(m === 11 || m === 12, `${m} pumps in 10 s`);
});

test('the shotgun reloads one shell every 0.5 s until full', () => {
  const a = createArsenal('shotgun');
  a.mags[0] = 0;
  stepWeapon(a, { ...idle, keys: KEY.RELOAD });
  shots(a, idle, 30);
  assert.equal(a.mags[0], 1);
  shots(a, idle, 120);
  assert.equal(a.mags[0], 5);
  assert.equal(a.reload, 0);
});

test('firing interrupts a shell-by-shell reload', () => {
  const a = createArsenal('shotgun');
  a.mags[0] = 0;
  stepWeapon(a, { ...idle, keys: KEY.RELOAD });
  shots(a, idle, 60); // two shells in
  assert.equal(stepWeapon(a, hold), true);
  assert.equal(a.reload, 0);
  assert.equal(a.mags[0], 1);
});

test('a shotgun pellet does 10 out to 8 m, falling to 2 from 18 m on: a full close blast kills 100 HP but not a Shield', () => {
  assert.equal(damageAt('shotgun', false, 5), 10);
  assert.equal(damageAt('shotgun', false, 8), 10);
  assert.ok(close(damageAt('shotgun', false, 13), 6));
  assert.ok(close(damageAt('shotgun', false, 40), 2));
  assert.equal(damageAt('shotgun', true, 5), 20);
  assert.equal(12 * damageAt('shotgun', false, 4), 120);
});

test('the pistol does 26 out to 25 m, falling to 19.5 from 40 m on', () => {
  assert.equal(damageAt('pistol', false, 25), 26);
  assert.ok(close(damageAt('pistol', false, 40), 19.5));
  assert.ok(close(damageAt('pistol', false, 60), 19.5));
});

test('every rifle headshot does a flat 160, at any range', () => {
  for (const d of [2, 20, 40, 50]) assert.equal(damageAt('rifle', true, d), 160, `${d} m`);
});

test('a rifle body hit does 30 out to 20 m, falling to 24 from 30 m on', () => {
  assert.equal(damageAt('rifle', false, 2), 30);
  assert.equal(damageAt('rifle', false, 20), 30);
  assert.ok(close(damageAt('rifle', false, 25), 27));
  assert.ok(close(damageAt('rifle', false, 35), 24));
});

test('a fresh life starts grounded at the spawn with full HP, magazines and the primary drawn', () => {
  const life = freshLife(1, 1.2, -3, 'shotgun');
  assert.deepEqual([life.mover.x, life.mover.y, life.mover.z, life.mover.grounded], [1, 1.2, -3, true]);
  assert.deepEqual([life.hp, life.alive], [100, true]);
  assert.deepEqual([life.arsenal.primary, life.arsenal.slot, life.arsenal.mags], ['shotgun', 0, [5, 12]]);
});

test('R reloads a partly used magazine, but not a full one', () => {
  const full = createArsenal('rifle');
  stepWeapon(full, { ...idle, keys: KEY.RELOAD });
  assert.equal(full.reload, 0);

  const used = createArsenal('rifle');
  shots(used, hold, 1);
  stepWeapon(used, { ...idle, keys: KEY.RELOAD });
  assert.equal(used.reload, 2.5);
  shots(used, idle, 150);
  assert.equal(used.mags[0], 25);
  assert.equal(used.reload, 0);
});
