// Bots find their way on foot: every pad from every spawn, on every map,
// walked through the real movement step with nav's steering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS } from '../../shared/constants.js';
import { createMover, step, KEY } from '../../shared/movement.js';
import { navFor, createRoute, follow } from './nav.js';

// Walk from `from` to `goal` the way a bot does: steer where follow() says,
// hop when it says. Returns the ticks taken, or why it failed.
function walk(nav, from, goal) {
  const m = { ...createMover(...from), grounded: true };
  const route = createRoute();
  for (let t = 0; t < 30 * 60; t++) {
    if (Math.hypot(goal[0] - m.x, goal[2] - m.z) < 0.6 && Math.abs(goal[1] - m.y) < 0.3) return t;
    const s = follow(nav, route, m, goal, t, { plans: 3 });
    if (!s) return 'gave up';
    step(m, { keys: KEY.FORWARD | (s.jump ? KEY.JUMP : 0), yaw: Math.atan2(-(s.x - m.x), -(s.z - m.z)) }, nav.map.boxes);
  }
  return 'timeout';
}

for (const id of MAPS) {
  test(`${id}: every pad is reachable on foot from every spawn`, () => {
    const nav = navFor(id);
    const fails = [];
    for (const spawn of nav.map.spawns) {
      for (const { pos } of nav.map.pads) {
        const r = walk(nav, spawn, pos);
        if (typeof r !== 'number') fails.push(`${spawn} → ${pos}: ${r}`);
      }
    }
    assert.deepEqual(fails, []);
  });
}

test('nav is cached per map id, and an unlisted id is never loaded', () => {
  assert.equal(navFor('arena_01'), navFor('arena_01'));
  assert.equal(navFor('../package'), null);
  assert.equal(navFor('arena_99'), null);
});
