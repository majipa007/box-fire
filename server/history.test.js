import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from './history.js';

const at = (x, z, crouch = false) => ({ x, y: 0, z, crouch });

// Player 1 walks +x one metre per tick from tick 1 to 100.
function walking() {
  const h = new History();
  for (let tick = 1; tick <= 100; tick++) h.record(tick, [[1, at(tick, 0)]]);
  return h;
}
const one = (list) => list.find((p) => p.id === 1);

test('a stored tick returns the positions recorded at it', () => {
  assert.equal(one(walking().at(90, 100)).x, 90);
});

test('a fractional tick blends between the two stored ticks around it', () => {
  assert.equal(one(walking().at(90.25, 100)).x, 90.25);
});

test('the render tick is clamped to the last second of history', () => {
  const h = walking();
  assert.equal(one(h.at(5, 100)).x, 40); // 100 - 60
  assert.equal(one(h.at(500, 100)).x, 100);
  assert.equal(one(h.at(Number.NaN, 100)).x, 100);
});

test('a player missing from the stored ticks is not a target there', () => {
  const h = walking();
  h.record(101, [[1, at(101, 0)], [2, at(0, 5)]]); // player 2 spawns at 101
  assert.equal(h.at(100.2, 101).length, 1);
  assert.equal(h.at(101, 101).length, 2);
});

test('a respawn between two ticks snaps to the nearer tick instead of streaking', () => {
  const h = new History();
  h.record(1, [[1, at(0, 0)]]);
  h.record(2, [[1, at(30, 30)]]);
  assert.equal(one(h.at(1.4, 2)).x, 0);
  assert.equal(one(h.at(1.6, 2)).x, 30);
});

test('crouch comes from the nearer tick', () => {
  const h = new History();
  h.record(1, [[1, at(0, 0, false)]]);
  h.record(2, [[1, at(0, 0, true)]]);
  assert.equal(one(h.at(1.4, 2)).crouch, false);
  assert.equal(one(h.at(1.6, 2)).crouch, true);
});
