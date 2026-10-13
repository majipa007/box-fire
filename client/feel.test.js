import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecoil, correct, resetFeel, updateFeel, view, crosshair, spreadPixels, blastShake, addTrauma, setBob, LOOK,
} from './feel.js';
import { self, reconcile } from './net.js';
import { WEAPONS, SNAP_DISTANCE, RUN_SPEED, WALK_SPEED, KICK_CLIMB_SHOTS, GRAVITY, JUMP_HEIGHT } from '../shared/constants.js';
import { spreadDegrees, createArsenal, stepWeapon } from '../shared/weapons.js';
import { createMover } from '../shared/movement.js';

const DEG = Math.PI / 180;
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);
const mover = (o = {}) => ({ ...createMover(0, 0, 0), grounded: true, ...o });

// A clock and a frame driver: ms of frames, step ms apart. each(frame) sees view after every frame.
let now = 0;
function frames(look, me, ms, step = 16, weapon = 'rifle', each = null) {
  for (let t = 0; t < ms; t += step) {
    updateFeel(step, (now += step), look, me, weapon);
    each?.(t + step);
  }
}
// Every test starts from rest: nothing owed, nothing easing.
function fresh() {
  resetFeel();
  setBob(true);
  const look = { yaw: 0, pitch: 0 };
  frames(look, null, 3000);
  return look;
}

test('a correction is drawn as an offset that halves every 50 ms, at any frame rate', () => {
  const look = fresh();
  correct({ x: 0.2, y: -0.1, z: 0 });
  frames(look, null, LOOK.correctionHalfLife, LOOK.correctionHalfLife);
  near(view.x, -0.1, 1e-9, 'x after one half-life');
  near(view.y, 0.05, 1e-9, 'y after one half-life');

  const fine = fresh();
  correct({ x: 0.2, y: 0, z: 0 });
  frames(fine, null, LOOK.correctionHalfLife, 5);
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

test('120 ms after a shot, 70% of the kick comes back: smoothly, halfway at 90 ms', () => {
  const look = fresh();
  const kick = WEAPONS.pistol.kick[0] * DEG;
  const shotAt = now;
  addRecoil('pistol', now);
  let first = null; // the first frame of the recovery, and how far it moved
  let last = 0;
  for (let t = 4; t <= 1500; t += 4) {
    updateFeel(4, (now = shotAt + t), look, null, 'pistol');
    if (t > 100 && t < 120) last = look.pitch;
    if (t === 124) first = last - look.pitch;
    if (t === 120 + LOOK.recoverHalfLife) near(look.pitch, kick * (1 - 0.35), kick * 0.01, 'half-way back');
  }
  assert.ok(first > 0 && first < kick * 0.01, `the spring eases off the mark (${first / kick} of the kick on frame one)`);
  near(look.pitch, kick * 0.3, 1e-6, 'pitch kept');
  near(look.yaw, 0, Math.abs(WEAPONS.pistol.kick[0] * DEG * 0.125), 'yaw');
});

test('recovery only returns 70% of the kick the player has not already pulled down', () => {
  const kick = WEAPONS.pistol.kick[0] * DEG;
  // Pulled down a third of it while it was still landing.
  let look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 16);
  look.pitch -= kick / 3;
  frames(look, null, 1500);
  near(look.pitch, kick * (2 / 3) * 0.3, 1e-6, 'partly pulled');
  // Pulled down past it: no recovery drags the aim below where they put it.
  look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 96);
  look.pitch -= kick * 1.5;
  const put = look.pitch;
  frames(look, null, 1000);
  near(look.pitch, put, kick * 0.3 * 2 ** (-96 / LOOK.kickHalfLife) * 1.01, 'over-pulled: only the kick still landing then');
  // Looked up meanwhile: that is theirs to keep; only the kick comes back out.
  look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 64);
  look.pitch += 0.1;
  frames(look, null, 1500);
  near(look.pitch, 0.1 + kick * 0.3, 1e-6, 'looked up');
  // Pulling down while it recovers spends the recovery first: never below the start.
  look = fresh();
  addRecoil('pistol', now);
  frames(look, null, 160);
  look.pitch -= kick * 0.6;
  frames(look, null, 1500);
  assert.ok(look.pitch >= -1e-9 && look.pitch < kick * 0.3, `pulled during recovery ended at ${look.pitch / kick} of the kick`);
});

test('a 10-round rifle spray with no mouse input settles at 30% ± 3% of its kick 500 ms after the last shot', () => {
  const look = fresh();
  // Real cadence: shots land on 60 Hz steps (gaps of 6 or 7 steps), late by
  // a few ms of timer jitter; frames run on their own clock in between.
  const arsenal = createArsenal('rifle');
  const shots = [];
  for (let i = 0; shots.length < 10; i++) {
    if (stepWeapon(arsenal, { fire: true, slot: 0, keys: 0 })) shots.push(now + i * (1000 / 60) + ((i * 37) % 7));
  }
  const [base, climb] = WEAPONS.rifle.kick;
  let total = 0;
  for (let n = 1; n <= 10; n++) total += (base + climb * Math.min(n, KICK_CLIMB_SHOTS)) * DEG;
  const lastShot = shots.at(-1);
  let last = look.pitch;
  let t = now + 5;
  for (; shots.length; t += 1000 / 60) {
    while (shots.length && shots[0] <= t) addRecoil('rifle', shots.shift());
    updateFeel(1000 / 60, (now = t), look, null, 'rifle', true); // trigger held throughout
    assert.ok(look.pitch >= last, `the aim dropped mid-spray at ${Math.round(now - lastShot)} ms`);
    last = look.pitch;
  }
  // Released on the next step; frames until 500 ms after the last shot.
  for (; t <= lastShot + 500; t += 1000 / 60) updateFeel(1000 / 60, (now = t), look, null, 'rifle', false);
  updateFeel(lastShot + 500 - now, (now = lastShot + 500), look, null, 'rifle', false);
  near(look.pitch / total, 0.3, 0.03, 'share of the kick kept');
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

// The deepest dip, when it came, and the offset 210 ms after touchdown.
function landing(vy) {
  const look = fresh();
  frames(look, mover({ grounded: false, vy: -vy }), 32);
  let low = 0, lowAt = 0, after = null;
  frames(look, mover(), 600, 2, 'rifle', (t) => {
    if (view.y < low) [low, lowAt] = [view.y, t];
    if (t === LOOK.landDown + LOOK.landBack) after = view.y;
  });
  return { low, lowAt, after };
}

test('landing dips the eye 0.009 m per m/s of fall, 70 ms down and 140 ms back', () => {
  const vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT); // a 1 m jump: 6.32 m/s
  const { low, lowAt, after } = landing(vy);
  near(low, -0.057, 0.0005, 'deepest dip after a 1 m jump');
  near(lowAt, LOOK.landDown, 2, 'ms to the bottom');
  near(after, 0, 1e-9, 'back up 140 ms later');
  near(landing(12).low, -LOOK.landDipMax, 1e-9, 'a long fall is capped');
  // Standing on the ground the whole time: nothing.
  const look = fresh();
  frames(look, mover(), 300);
  near(view.y, 0, 1e-12, 'never airborne');
});

test('landing again mid-dip carries on down from where the eye is', () => {
  const look = fresh();
  frames(look, mover({ grounded: false, vy: -6 }), 32);
  frames(look, mover(), 100);
  const y = view.y;
  frames(look, mover({ grounded: false, vy: -1 }), 4, 4);
  const air = view.y;
  frames(look, mover(), 4, 4);
  assert.ok(Math.abs(view.y - air) < 0.003 && Math.abs(air - y) < 0.003, `no jump in the eye: ${y} ${air} ${view.y}`);
});

test('bob dips 8 mm on each footfall and rolls ±0.2°, only when running on the ground', () => {
  const look = fresh();
  frames(look, mover(), 500);
  near(view.y, 0, 1e-12, 'standing');
  near(view.roll, 0, 1e-12, 'standing');
  let low = 0, high = -1, roll = 0, steps = 0, stepY = [];
  const run = mover({ vz: -RUN_SPEED });
  frames(look, run, 300); // fade in
  frames(look, run, 2000, 4, 'rifle', () => {
    low = Math.min(low, view.y);
    high = Math.max(high, view.y);
    roll = Math.max(roll, Math.abs(view.roll));
    if (view.step) steps++, stepY.push(view.y);
  });
  near(low, -LOOK.bobDip, 1e-4, 'dip');
  near(high, 0, 1e-4, 'top of the stride');
  near(roll, 0.2 * DEG, 0.002 * DEG, 'roll');
  near(steps, (RUN_SPEED * 2) / LOOK.stride, 1, 'a footfall every 2.2 m');
  for (const y of stepY) near(y, -LOOK.bobDip, 3e-4, 'the dip bottoms out on the footfall');
  // Walking, at the footstep threshold or below: no bob, no footfalls.
  let walkSteps = 0;
  frames(look, mover({ vz: -WALK_SPEED }), 1000, 16, 'rifle', () => { walkSteps += view.step; });
  near(view.y, 0, 1e-12, 'walking');
  assert.equal(walkSteps, 0);
  // In the air it fades out within 150 ms.
  frames(look, run, 500);
  frames(look, mover({ vz: -RUN_SPEED, grounded: false, vy: 3 }), LOOK.bobFade + 16);
  near(view.y, 0, 1e-12, 'in the air');
  near(view.roll, 0, 1e-12, 'no roll in the air');
});

test('with View bob off the eye stays still, but footfalls still come', () => {
  const look = fresh();
  setBob(false);
  let steps = 0, moved = 0;
  frames(look, mover({ vx: RUN_SPEED }), 2000, 16, 'rifle', () => {
    steps += view.step;
    moved = Math.max(moved, Math.abs(view.y), Math.abs(view.roll));
  });
  setBob(true);
  assert.equal(moved, 0);
  assert.ok(steps >= 4, `${steps} footfalls`);
});

test('a blast within 8 m shakes roll and position by trauma², never the aim, and dies out', () => {
  const me = mover({ x: 3, z: -2 });
  const peak = (d) => {
    const look = fresh();
    look.yaw = 0.7;
    look.pitch = -0.2;
    blastShake({ e: 'blast', k: 'shunt', x: me.x + d, y: me.y + 1, z: me.z }, 1, me);
    const p = { roll: 0, move: 0 };
    frames(look, me, 1000, 8, 'rifle', () => {
      assert.equal(look.yaw, 0.7, 'yaw');
      assert.equal(look.pitch, -0.2, 'pitch');
      p.roll = Math.max(p.roll, Math.abs(view.roll));
      p.move = Math.max(p.move, Math.abs(view.y), Math.hypot(view.x, view.z));
    });
    near(view.roll, 0, 1e-12, 'still after a second');
    near(view.y, 0, 1e-12, 'still after a second');
    return p;
  };
  const point = peak(0); // trauma 0.8
  assert.ok(point.roll <= 1.5 * DEG * 0.64 && point.roll > 1.5 * DEG * 0.64 * 0.5, `roll ${point.roll / DEG}°`);
  assert.ok(point.move <= 0.06 * 0.64 && point.move > 0.06 * 0.64 * 0.5, `moved ${point.move} m`);
  const half = peak(4); // trauma 0.4
  assert.ok(half.roll <= 1.5 * DEG * 0.16 && half.roll > 0, `roll at 4 m ${half.roll / DEG}°`);
  assert.equal(peak(8.5).roll, 0, 'out of range');
});

test('fizzles, Bolt impacts and our own Barge do not shake; trauma caps at 1', () => {
  const me = mover();
  const shaken = (m) => {
    const look = fresh();
    blastShake(m, 1, me);
    let roll = 0;
    frames(look, me, 300, 8, 'rifle', () => { roll = Math.max(roll, Math.abs(view.roll)); });
    return roll;
  };
  const at = { x: 0, y: 1, z: 0 };
  assert.equal(shaken({ e: 'boom', k: 'shunt', r: 0, ...at }), 0, 'fizzle');
  assert.equal(shaken({ e: 'blast', k: 'bolt', ...at }), 0, 'bolt');
  assert.equal(shaken({ e: 'boom', k: 'barge', r: 5, id: 1, ...at }), 0, 'own barge');
  assert.equal(shaken({ e: 'blast', k: 'barge', ...at }), 0, 'barge with no id');
  assert.ok(shaken({ e: 'boom', k: 'barge', r: 5, id: 2, ...at }) > 0, 'their barge');
  assert.ok(shaken({ e: 'boom', k: 'mine', r: 2.5, id: 2, ...at }) > 0, 'a mine');
  const look = fresh();
  for (let i = 0; i < 5; i++) addTrauma(0.8);
  let roll = 0;
  frames(look, me, 300, 8, 'rifle', () => { roll = Math.max(roll, Math.abs(view.roll)); });
  assert.ok(roll <= 1.5 * DEG, `capped roll ${roll / DEG}°`);
});

test('Nitro adds 6° of fov, eased in over 150 ms and out over 300 ms', () => {
  const look = fresh();
  assert.equal(view.fov, 0);
  const boosted = mover({ boost: 4 });
  frames(look, boosted, 75, 5);
  near(view.fov, 3, 1e-9, 'half-way in');
  frames(look, boosted, 75, 5);
  near(view.fov, 6, 1e-9, 'in');
  frames(look, mover(), 150, 5);
  near(view.fov, 3, 1e-9, 'half-way out');
  frames(look, mover(), 150, 5);
  near(view.fov, 0, 1e-9, 'out');
});

test('spreadPixels maps a cone to CSS px from the screen centre', () => {
  near(spreadPixels(45, 90, 1000), 500, 1e-9, '45° in a 90° view');
  near(spreadPixels(0, 60, 1080), 0, 1e-12, 'no spread');
});
