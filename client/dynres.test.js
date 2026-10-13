import test from 'node:test';
import assert from 'node:assert/strict';
import { createDynres } from './dynres.js';

// Feeds frames of `ms` for `seconds`, applying each change; returns the final scale.
function run(frame, state, ms, seconds) {
  for (const end = state.now + seconds * 1000; state.now < end; state.now += ms) {
    const next = frame(ms, state.now, state.scale, state.max, state.floor);
    if (next !== null) state.scale = next;
  }
  return state.scale;
}

test('steady 60 fps never changes the scale', () => {
  const s = { now: 0, scale: 1, max: 1, floor: 0.6 };
  assert.equal(run(createDynres(), s, 16.6, 60), 1);
});

test('slow frames drop 0.1 at most every 2 s, down to the floor', () => {
  const frame = createDynres();
  const s = { now: 0, scale: 1, max: 1, floor: 0.6 };
  run(frame, s, 25, 0.6); // 24 slow frames
  assert.equal(s.scale, 0.9);
  run(frame, s, 25, 1.3); // inside the 2 s gap
  assert.equal(s.scale, 0.9);
  run(frame, s, 25, 20);
  assert.equal(s.scale, 0.6); // the Default floor
});

test('recovery steps up 0.05 per 10 quiet seconds, held below the old scale for 30 s', () => {
  const frame = createDynres();
  const s = { now: 0, scale: 1, max: 1, floor: 0.6 };
  run(frame, s, 25, 0.6);
  assert.equal(s.scale, 0.9);
  const dropAt = s.now;
  run(frame, s, 16, 10.1);
  assert.equal(s.scale, 0.95);
  run(frame, s, 16, 15); // 25 s after the drop: 1.0 is still held off
  assert.equal(s.scale, 0.95);
  run(frame, s, 16, dropAt + 31000 - s.now);
  assert.equal(s.scale, 1);
});

test('never above the user setting', () => {
  const s = { now: 0, scale: 0.7, max: 0.7, floor: 0.5 };
  assert.equal(run(createDynres(), s, 10, 60), 0.7);
});
