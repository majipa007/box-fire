// How bots shoot: a role and an ideal range read from each gun's numbers,
// and human-like aim whose reaction and accuracy depend on skill.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, DT, RUN_SPEED } from '../../shared/constants.js';
import { shotRng } from '../../shared/rng.js';
import { createMover, step, KEY } from '../../shared/movement.js';
import { createArsenal, stepWeapon, eyeOf, spreadDegrees, shotDirs, traceShot, shotHeat } from '../../shared/weapons.js';
import { roleOf, idealRange, SKILLS, createAim, acquire, stepAim, shouldFire, standsToShoot } from './aim.js';

const median = (xs) => xs.sort((a, b) => a - b)[xs.length >> 1];

test('roles come from the numbers: pellets are close, auto bursts, slow semi is precision, other semi taps', () => {
  assert.equal(roleOf(WEAPONS.shotgun), 'close');
  assert.equal(roleOf(WEAPONS.rifle), 'burst');
  assert.equal(roleOf(WEAPONS.pistol), 'tap');
  // Guns that do not exist yet: local objects, never keys added to WEAPONS.
  assert.equal(roleOf({ auto: false, rps: 1, mag: 5 }), 'precision');
  assert.equal(roleOf({ auto: false, rps: 2, mag: 8 }), 'tap');
  assert.equal(roleOf({ auto: true, rps: 12, mag: 30 }), 'burst');
  assert.equal(roleOf({ auto: true, rps: 3, pellets: 8, mag: 8 }), 'close');
});

test('ideal range: a sidearm fights at 12 m, falloff guns at 0.6 of where falloff starts, others at 18 m', () => {
  assert.equal(idealRange({ auto: false, rps: 6 }, true), 12);
  assert.equal(idealRange({ auto: false, rps: 6, falloff: { from: 25, to: 40, min: 0.75 } }, true), 12);
  assert.equal(idealRange({ auto: true, rps: 10, falloff: { from: 20, to: 30, min: 0.8 } }, false), 12);
  assert.equal(idealRange({ pellets: 12, falloff: { from: 8, to: 18, min: 0.2 } }, false), 4.8);
  assert.equal(idealRange({ auto: true, rps: 10 }, false), 18);
});

// The live gate on engage delay (first sight to first shot) per skill. Live
// play adds perception latency on top, so here only the top of each band
// binds; the live run checks the bottom.
const ENGAGE = { easy: [0.6, 0.9], normal: [0.3, 0.6], hard: [0.2, 0.3] };
// Median s from a foe appearing (anywhere in view, or dead ahead) to the
// bot being on target and ready to fire, over 300 seeded trials.
function readyTimes(sk, rand, anywhere) {
  const eye = [0, 1.6, 0], chest = [0, 1, -20];
  const ready = [];
  for (let n = 0; n < 300; n++) {
    const a = createAim(anywhere ? (rand() * 2 - 1) * (sk.fov / 2) * (Math.PI / 180) : 0, 0);
    acquire(a, sk, rand);
    for (let t = 1; t <= 180; t++) {
      if (stepAim(a, sk, DT, eye, chest, 0, rand)) { ready.push(t * DT); break; }
    }
  }
  return ready;
}

test('a bot never fires before its reaction time, then is on target within its skill band', () => {
  const rand = shotRng(7, 0, 0);
  for (const [skill, [lo, hi]] of Object.entries(ENGAGE)) {
    const sk = SKILLS[skill], ready = readyTimes(sk, rand, true);
    assert.ok(Math.min(...ready) >= sk.react - 1e-9, `${skill} fired at ${Math.min(...ready)} s, before reacting`);
    const m = median(ready);
    assert.ok(m <= hi, `${skill}: median ${m.toFixed(2)} s, want at most ${hi} s (live: ${lo}-${hi} s)`);
  }
});

// Dead ahead, turning costs nothing, and the quickest tenth of trials (the
// ones whose flick needed no settling) show the reaction alone. Each skill
// must be at least 0.1 s slower than the one above it (the narrowest gap
// between the bands' lower edges: normal 0.3, hard 0.2), less 2 ticks.
const p10 = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 10)];
test('to a foe dead ahead, each skill reacts at least 0.1 s slower than the skill above it', () => {
  const rand = shotRng(8, 0, 0), gap = 0.1 - 2 / 60;
  const [easy, normal, hard] = ['easy', 'normal', 'hard'].map((k) => p10(readyTimes(SKILLS[k], rand, false)));
  assert.ok(easy - normal >= gap, `easy ${easy.toFixed(2)} s reacts like normal ${normal.toFixed(2)} s`);
  assert.ok(normal - hard >= gap, `normal ${normal.toFixed(2)} s reacts like hard ${hard.toFixed(2)} s`);
});

// A bot with the rifle against a target strafing left and right (0.25-0.8 s
// per leg) on open floor, through the real spread and shot trace. The bot
// sees where the target was `lag` ago, partly led, and strafes too unless
// it rolled standing still to shoot.
function duel(sk, dist, rand) {
  const floor = [{ min: [-50, -1, -50], max: [50, 0, 50] }];
  const me = { ...createMover(0, 0, 0), grounded: true };
  const tg = { ...createMover(0, 0, -dist), grounded: true };
  const ars = createArsenal('rifle');
  const a = createAim((rand() - 0.5) * 0.5, 0);
  acquire(a, sk, rand);
  const hist = [];
  const lagT = Math.round(sk.lag / DT);
  let dir = 1, flipAt = 0, shots = 0, hits = 0;
  for (let t = 0; t < 4 / DT; t++) {
    if (t >= flipAt) { dir = -dir; flipAt = t + Math.round((0.25 + 0.55 * rand()) / DT); }
    step(tg, { keys: dir > 0 ? KEY.RIGHT : KEY.LEFT, yaw: 0 }, floor);
    hist.push([tg.x, tg.y, tg.z, tg.vx, tg.vz]);
    const [x, y, z, vx, vz] = hist[Math.max(0, hist.length - 1 - lagT)];
    const seen = [x + vx * sk.lead * sk.lag, y + (a.head ? 1.65 : 1.0), z + vz * sk.lead * sk.lag];
    step(me, { keys: standsToShoot(a, WEAPONS.rifle) ? 0 : Math.floor(t / 40) % 2 ? KEY.LEFT : KEY.RIGHT, yaw: a.yaw }, floor);
    stepAim(a, sk, DT, eyeOf(me), seen, Math.hypot(me.vx, me.vz) / RUN_SPEED, rand);
    const fire = shouldFire(a, sk, WEAPONS.rifle, t, spreadDegrees('rifle', me, ars.heat), ars.heat);
    if (stepWeapon(ars, { fire, slot: 0, keys: 0 })) {
      shots++;
      const [d] = shotDirs(a.yaw, a.pitch, 'rifle', me, shotRng(1, 1, shots), shotHeat(ars));
      if (traceShot(eyeOf(me), d, floor, [{ id: 2, ...tg }]).id !== null) hits++;
    }
  }
  return [shots, hits];
}

// The judge's bands for rifle hits at 20 m. Re-check them whenever the
// rifle's spread numbers change.
const HITS = { easy: [15, 24], normal: [25, 35], hard: [36, 50] };

test('rifle hit rate at 20 m against a strafer rises with skill, within each band', () => {
  const rand = shotRng(11, 0, 0);
  const pct = {};
  for (const [skill, [lo, hi]] of Object.entries(HITS)) {
    let shots = 0, hits = 0;
    for (let n = 0; n < 300; n++) { const [s, h] = duel(SKILLS[skill], 20, rand); shots += s; hits += h; }
    pct[skill] = (100 * hits) / shots;
    assert.ok(pct[skill] >= lo && pct[skill] <= hi, `${skill}: ${pct[skill].toFixed(1)}% hits, want ${lo}-${hi}%`);
  }
  assert.ok(pct.easy < pct.normal && pct.normal < pct.hard);
});

test('semi-auto guns click at the slower of skill and gun, releasing between clicks; auto guns hold', () => {
  const sk = SKILLS.normal; // taps 5 times a second, auto duty 0.8
  const pulls = (w, skill = sk) => {
    const a = createAim();
    a.ready = true; a.tol = 2;
    const ticks = [];
    for (let t = 0; t < 180; t++) if (shouldFire(a, skill, w, t, 0)) ticks.push(t);
    return ticks;
  };
  assert.equal(pulls(WEAPONS.pistol).length, 15); // 5/s for 3 s
  assert.equal(pulls({ auto: false, rps: 1, mag: 5 }).length, 3); // a 1/s gun that does not exist yet
  const fast = pulls({ auto: false, rps: 60, mag: 30 }, { ...sk, tapRate: 60 });
  assert.ok(fast.every((t, i) => i === 0 || t - fast[i - 1] >= 2), 'never two ticks in a row');
  assert.equal(pulls(WEAPONS.rifle).length, 144); // 24 of every 30 ticks
});

// ---- arsenal: every registry gun gets a role from its numbers ----

test('arsenal roles: autos and burst guns fire in duty bursts, a scope or a heavy semi is precision, the rest tap', () => {
  const want = {
    rifle: 'burst', pistol: 'tap', shotgun: 'close', handcannon: 'precision', machinepistol: 'burst',
    smg: 'burst', burst: 'burst', lmg: 'burst', marksman: 'precision', sniper: 'precision',
  };
  assert.deepEqual(Object.fromEntries(Object.keys(want).map((id) => [id, roleOf(WEAPONS[id])])), want); // later guns need no entry here
  assert.equal(idealRange(WEAPONS.sniper, false), 30, 'a scope holds a long range');
  assert.equal(idealRange(WEAPONS.marksman, false), 18);
});

test('arsenal: a burst gun is clicked once per burst cycle, a one-tick press each', () => {
  const a = createAim();
  a.ready = true; a.tol = 2;
  const ticks = [];
  for (let t = 0; t < 180; t++) if (shouldFire(a, SKILLS.normal, WEAPONS.burst, t, 0)) ticks.push(t);
  const cycle = Math.round(60 / (WEAPONS.burst.rps / WEAPONS.burst.burst.count)); // 21 ticks
  assert.equal(ticks.length, Math.ceil(180 / cycle));
  assert.ok(ticks.every((t, i) => i === 0 || t - ticks[i - 1] === cycle), `clicks ${ticks}`);
});

test('arsenal: a scoped gun fires only when its cone fits the target, standing or not, and stands from just before reacting', () => {
  const a = createAim();
  a.ready = true; a.tol = 1; a.react = 0.3; a.t = 0.9; // in a strafe half of the 1 s rhythm
  assert.equal(standsToShoot(a, WEAPONS.marksman), false, 'a marksman keeps the rhythm');
  assert.equal(standsToShoot(a, WEAPONS.sniper), true, 'a scope stands throughout');
  a.t = 0.1;
  assert.equal(standsToShoot(a, WEAPONS.sniper), false, 'not before it has nearly reacted');
  a.t = 0.9;
  assert.equal(shouldFire(a, SKILLS.normal, WEAPONS.sniper, 100, WEAPONS.sniper.spreadStand), false, 'the hip cone is too wide');
  assert.equal(shouldFire(a, SKILLS.normal, WEAPONS.sniper, 100, WEAPONS.sniper.scope.spread), true, 'scoped in');
});
