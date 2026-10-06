import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecoil, correct, resetFeel, updateFeel, view, crosshair, spreadPixels,
  CORRECTION_HALF_LIFE_MS, RECOVER_MAX_DEG, LAND_DIP_M, LAND_DIP_PEAK_MS, STRAFE_ROLL_DEG,
} from './feel.js';
import { self, reconcile } from './net.js';
import { WEAPONS, SNAP_DISTANCE, RUN_SPEED, GRAVITY, JUMP_HEIGHT } from '../shared/constants.js';
import { spreadDegrees, createArsenal, stepWeapon } from '../shared/weapons.js';
import { createMover } from '../shared/movement.js';

const DEG = Math.PI / 180;
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const mover = (o = {}) => ({ ...createMover(0, 0, 0), grounded: true, ...o });

// A clock and a frame driver: ms of frames, step ms apart.
let now = 0;
function frames(look, me, ms, step = 16, weapon = 'rifle') {
  for (let t = 0; t < ms; t += step) updateFeel(step, (now += step), look, me, weapon);
}
// Every test starts from rest: nothing owed, nothing easing.
function fresh() {
  resetFeel();
  const look = { yaw: 0, pitch: 0 };
  frames(look, null, 3000);
  return look;
}

test('a correction is drawn as an offset that halves every 50 ms, at any frame rate', () => {
  const look = fresh();
  correct({ x: 0.2, y: -0.1, z: 0 });
  frames(look, null, CORRECTION_HALF_LIFE_MS, CORRECTION_HALF_LIFE_MS);
  near(view.x, -0.1, 1e-9, 'x after one half-life');
  near(view.y, 0.05, 1e-9, 'y after one half-life');

  const fine = fresh();
  correct({ x: 0.2, y: 0, z: 0 });
  frames(fine, null, CORRECTION_HALF_LIFE_MS, 5);
  near(view.x, -0.1, 1e-9, 'x after ten 5 ms frames');
});

test('a correction longer than SNAP_DISTANCE snaps instead of sliding', () => {
  const look = fresh();
  correct({ x: SNAP_DISTANCE + 0.5, y: 0, z: 0 });
  frames(look, null, 16);
  assert.equal(view.x, 0);
  // So does a pile of small ones that add up to that much.
  for (let i = 0; i < 5; i++) correct({ x: 0, y: 0, z: SNAP_DISTANCE / 4 });
  frames(look, null, 16);
  assert.equal(view.z, 0);
});

test('reconcile reports how far it moved our player', () => {
  Object.assign(self, { mover: mover(), arsenal: createArsenal('rifle'), pending: [] });
  const me = { mover: mover({ x: 0.3, z: -0.1 }), arsenal: createArsenal('rifle'), hp: 100, alive: true };
  const d = reconcile({ ack: 0, me }, []);
  near(d.x, 0.3, 1e-12, 'dx');
  near(d.y, 0, 1e-12, 'dy');
  near(d.z, -0.1, 1e-12, 'dz');
  assert.equal(reconcile({ ack: 0, me: null }, []), null);
});

test('a kick eases into the aim over a few frames instead of snapping', () => {
  const look = fresh();
  const kick = WEAPONS.pistol.kick[0] * DEG;
  addRecoil('pistol', now);
  frames(look, null, 16);
  assert.ok(look.pitch > kick * 0.5 && look.pitch < kick * 0.9, `first frame ${look.pitch / DEG}°`);
  frames(look, null, 48);
  near(look.pitch, kick, kick * 0.05, 'after 64 ms');
});

test('recoil recovers back to the start when the player does not pull down', () => {
  const look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 1500);
  near(look.pitch, 0, 1e-6, 'pitch after recovery');
  near(look.yaw, 0, 1e-6, 'yaw after recovery');
});

test('recovery only returns the kick the player has not already pulled down', () => {
  const kick = WEAPONS.pistol.kick[0] * DEG;
  // Pulled down a third of it while it was still landing: back to the start.
  let look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 16);
  look.pitch -= kick / 3;
  frames(look, null, 1500);
  near(look.pitch, 0, 1e-6, 'partly pulled');
  // Pulled down past it: no recovery drags the aim below where they put it.
  look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 64);
  look.pitch -= kick * 1.5;
  const put = look.pitch;
  frames(look, null, 1000);
  near(look.pitch, put, 1e-6, 'over-pulled');
  // Looked up meanwhile: that is theirs to keep; only the kick comes back out.
  look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 64);
  look.pitch += 0.1;
  frames(look, null, 1500);
  near(look.pitch, 0.1, 1e-6, 'looked up');
});

test('a held spray climbs without recovering, and only RECOVER_MAX_DEG of it comes back', () => {
  const look = fresh();
  // Real cadence: shots land on 60 Hz steps (gaps of 6 or 7 steps), late by
  // a few ms of timer jitter; frames run on their own clock in between.
  const arsenal = createArsenal('rifle');
  const shots = [];
  for (let i = 0; shots.length < 20; i++) {
    if (stepWeapon(arsenal, { fire: true, slot: 0, keys: 0 })) shots.push(now + i * (1000 / 60) + ((i * 37) % 7));
  }
  const start = now;
  let last = look.pitch;
  for (let t = start + 5; shots.length || t < start + 2500; t += 1000 / 60) {
    while (shots.length && shots[0] <= t) addRecoil('rifle', shots.shift());
    updateFeel(1000 / 60, (now = t), look, null, 'rifle', true); // trigger held throughout
    assert.ok(look.pitch >= last, `the aim dropped mid-spray at ${Math.round(now - start)} ms`);
    last = look.pitch;
  }
  const peak = look.pitch;
  assert.ok(peak / DEG > RECOVER_MAX_DEG + 4, `climbed ${peak / DEG}°`);
  updateFeel(16, (now += 16), look, null, 'rifle', true);
  near(look.pitch, peak, 1e-9, 'still held');
  for (let t = 0; t < 1500; t += 16) updateFeel(16, (now += 16), look, null, 'rifle', false);
  near(look.pitch, peak - RECOVER_MAX_DEG * DEG, 0.05 * DEG, 'after release');
});

test('the crosshair shows the true cone at rest, blooms on a shot, and settles back', () => {
  const look = fresh();
  near(crosshair.spread, WEAPONS.rifle.spreadStand, 1e-6, 'standing');
  const running = mover({ vx: RUN_SPEED });
  frames(look, running, 500);
  assert.equal(crosshair.cone, spreadDegrees('rifle', running));
  near(crosshair.spread, WEAPONS.rifle.spreadMove, 1e-3, 'running');
  const still = mover();
  frames(look, still, 500);
  addRecoil('rifle', now);
  frames(look, still, 16);
  assert.ok(crosshair.spread > WEAPONS.rifle.spreadStand + 0.1, `bloomed to ${crosshair.spread}`);
  frames(look, still, 1500);
  near(crosshair.spread, WEAPONS.rifle.spreadStand, 1e-3, 'settled');
});

test('landing dips the eye by about LAND_DIP_M after a full jump, then springs back', () => {
  const look = fresh();
  const fall = -Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
  frames(look, mover({ grounded: false, vy: fall }), 32);
  let low = 0;
  let lowAt = 0;
  for (let t = 0; t < 600; t += 4) {
    updateFeel(4, (now += 4), look, mover(), 'rifle');
    if (view.y < low) [low, lowAt] = [view.y, t + 4];
  }
  near(low, -LAND_DIP_M, LAND_DIP_M * 0.05, 'deepest dip');
  near(lowAt, LAND_DIP_PEAK_MS, 8, 'ms to the bottom');
  near(view.y, 0, 0.002, 'after 600 ms');
  // Standing on the ground the whole time: nothing.
  fresh();
  frames(look, mover(), 300);
  near(view.y, 0, 1e-9, 'never airborne');
});

test('strafing right leans right, up to STRAFE_ROLL_DEG; standing still is level', () => {
  const look = fresh();
  frames(look, mover({ vx: RUN_SPEED }), 1000); // yaw 0: +x is to our right
  near(view.roll, -STRAFE_ROLL_DEG * DEG, 1e-6, 'strafing right');
  frames(look, mover({ vz: -RUN_SPEED }), 1000); // straight ahead
  near(view.roll, 0, 1e-6, 'running forward');
});

test('bob only moves a running, grounded eye, and fades out in the air', () => {
  const look = fresh();
  frames(look, mover(), 500);
  near(view.x, 0, 1e-9, 'standing x');
  near(view.y, 0, 1e-9, 'standing y');
  let lowest = 0;
  for (let t = 0; t < 1000; t += 16) {
    frames(look, mover({ vz: -RUN_SPEED }), 16);
    lowest = Math.min(lowest, view.y);
  }
  assert.ok(lowest < -0.008, `bob dipped ${lowest} m`);
  frames(look, mover({ vz: -RUN_SPEED, grounded: false, vy: 3 }), 1000);
  near(view.y, 0, 1e-4, 'in the air');
});

test('spreadPixels maps a cone to CSS px from the screen centre', () => {
  near(spreadPixels(45, 90, 1000), 500, 1e-9, '45° in a 90° view');
  near(spreadPixels(0, 60, 1080), 0, 1e-12, 'no spread');
});
