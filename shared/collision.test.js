import test from 'node:test';
import assert from 'node:assert/strict';
import { rayBox } from './collision.js';

const box = { min: [-1, 0, -6], max: [1, 2, -4] }; // 2 m cube, near face at z = -4
const D = Math.SQRT1_2;

test('a ray hits a box at the distance of the face it enters', () => {
  assert.equal(rayBox([0, 1, 0], [0, 0, -1], box.min, box.max), 4);
  assert.equal(rayBox([5, 1, -5], [-1, 0, 0], box.min, box.max), 4);
  const t = rayBox([3, 1, -3], [-D, 0, -D], box.min, box.max); // enters the x = 1 face at z = -5
  assert.ok(Math.abs(t - 2 * Math.SQRT2) < 1e-12, `t=${t}`);
});

test('a ray that misses, points away or runs parallel outside the box returns Infinity', () => {
  assert.equal(rayBox([0, 1, 0], [0, D, -D], box.min, box.max), Infinity); // passes over the top
  assert.equal(rayBox([0, 1, 0], [0, 0, 1], box.min, box.max), Infinity); // pointing away
  assert.equal(rayBox([3, 1, 0], [0, 0, -1], box.min, box.max), Infinity); // parallel, beside it
});

test('a ray starting inside a box hits it immediately', () => {
  assert.equal(rayBox([0, 1, -5], [0, 0, -1], box.min, box.max), 0);
});
