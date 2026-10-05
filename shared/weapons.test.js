import test from 'node:test';
import assert from 'node:assert/strict';
import { createArsenal, stepWeapon, traceShot } from './weapons.js';
import { KEY } from './movement.js';
import { prepareMap } from './collision.js';

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
