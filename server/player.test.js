import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from './player.js';
import { KEY } from '../shared/movement.js';

const TICK = 1000 / 60;
const input = (s, extra = {}) => ({ t: 'input', s, rt: 0, keys: KEY.FORWARD, yaw: 0.5, pitch: 0.1, fire: false, shot: 0, slot: 0, ...extra });
const player = () => new Player(1, 'Sam', 0, {}, false);
const seqs = (inputs) => inputs.map((i) => i.s);

test('inputs arriving one per tick are applied one per tick, after one tick of buffering', () => {
  const p = player();
  const applied = [];
  for (let tick = 0; tick < 6; tick++) {
    p.receive(input(tick + 1), tick * TICK);
    applied.push(seqs(p.nextInputs(tick * TICK)));
  }
  assert.deepEqual(applied, [[], [1], [2], [3], [4], [5]]);
  assert.equal(p.ack, 5);
});

// Feed inputs 1..n one per tick so the queue is in its steady state
// (input n is still buffered).
function steady(p, n) {
  for (let s = 1; s <= n; s++) {
    p.receive(input(s), (s - 1) * TICK);
    p.nextInputs((s - 1) * TICK);
  }
  return n * TICK;
}

test('an empty tick applies nothing and rebuffers; the delayed input is still used', () => {
  const p = player();
  const now = steady(p, 3);
  assert.deepEqual(seqs(p.nextInputs(now)), [3]);
  assert.deepEqual(seqs(p.nextInputs(now + TICK)), []); // 4 is late: nothing is invented
  p.receive(input(4), now + TICK + 5);
  assert.deepEqual(seqs(p.nextInputs(now + 2 * TICK)), []); // refilling the buffer
  p.receive(input(5), now + 2 * TICK + 5);
  assert.deepEqual(seqs(p.nextInputs(now + 3 * TICK)), [4]);
  assert.equal(p.ack, 4);
});

test('a backlog is caught up at most two inputs per tick', () => {
  const p = player();
  const now = steady(p, 3);
  for (let s = 4; s <= 9; s++) p.receive(input(s), now); // a burst after a stall
  const applied = [];
  for (let i = 0; i < 5; i++) applied.push(seqs(p.nextInputs(now + i * TICK)));
  // queue 3..9: two per tick while more than two are waiting, then one, then empty
  assert.deepEqual(applied, [[3, 4], [5, 6], [7, 8], [9], []]);
});

test('beyond the maximum backlog the oldest inputs are dropped', () => {
  const p = player();
  const now = steady(p, 3);
  for (let s = 4; s <= 20; s++) p.receive(input(s), now); // 18 waiting, the cap is 8
  assert.deepEqual(seqs(p.nextInputs(now)), [13, 14]);
  assert.equal(p.ack, 14);
});

test('after 250 ms without input the player goes neutral, then picks up where the client left off', () => {
  const p = player();
  const now = steady(p, 3); // last input received at 2 ticks
  p.nextInputs(now); // 3
  const later = 2 * TICK + 300;
  const [neutral] = p.nextInputs(later);
  assert.equal(neutral.keys, 0);
  assert.equal(neutral.fire, false);
  assert.equal(neutral.yaw, 0.5);
  assert.equal(p.ack, 3);
  p.receive(input(4), later + 100);
  assert.deepEqual(seqs(p.nextInputs(later + 100)), []); // buffer refills
  p.receive(input(5), later + 100 + TICK);
  assert.deepEqual(seqs(p.nextInputs(later + 100 + TICK)), [4]);
});

test('bursty arrival never loses an input', () => {
  const p = player();
  const applied = [];
  for (let k = 1; k <= 60; k++) {
    const now = k * TICK;
    applied.push(...seqs(p.nextInputs(now)).filter((s) => s !== undefined)); // skip neutral steps
    // Inputs land in irregular clumps, like a client rendering at 20-40 fps.
    if (k % 3 === 0) for (const s of [k - 2, k - 1, k]) p.receive(input(s), now + 1);
  }
  const expected = Array.from({ length: applied.length }, (_, i) => i + 1);
  assert.deepEqual(applied, expected); // in order, none skipped, none invented
  assert.ok(applied.length >= 55);
});

test('a repeated or stale seq is ignored', () => {
  const p = player();
  const now = steady(p, 3);
  p.nextInputs(now); // 3
  p.receive(input(2), now);
  p.receive(input(3), now);
  assert.deepEqual(seqs(p.nextInputs(now + TICK)), []);
  assert.equal(p.ack, 3);
});
