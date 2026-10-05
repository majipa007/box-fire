import test from 'node:test';
import assert from 'node:assert/strict';
import { shotRng } from './rng.js';

const roll = (seed, player, shot, n = 5) => {
  const r = shotRng(seed, player, shot);
  return Array.from({ length: n }, r);
};

test('the same seed, player and shot always roll the same numbers', () => {
  assert.deepEqual(roll(123456, 4, 7), roll(123456, 4, 7));
});

test('a different shot, player or seed rolls different numbers', () => {
  const base = roll(123456, 4, 7);
  assert.notDeepEqual(roll(123456, 4, 8), base);
  assert.notDeepEqual(roll(123456, 5, 7), base);
  assert.notDeepEqual(roll(654321, 4, 7), base);
});

test('rolls are uniform-ish in [0, 1)', () => {
  const values = roll(99, 1, 1, 10000);
  assert.ok(values.every((v) => v >= 0 && v < 1));
  const mean = values.reduce((a, b) => a + b) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.02, `mean ${mean}`);
});
