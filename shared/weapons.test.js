import test from 'node:test';
import assert from 'node:assert/strict';
import { createArsenal, stepWeapon, traceShot, spreadDegrees, shotDirs, aimDir, damageAt, freshLife, shotHeat, weaponOf, scopedIn, scopeShare, moveFactor } from './weapons.js';
import { GUNS } from './guns/index.js'; // arsenal
import { KEY } from './movement.js';
import { prepareMap } from './collision.js';
import { DT } from './constants.js';
import { shotRng } from './rng.js';

const mover = (speed, extra = {}) => ({ x: 0, y: 0, z: 0, vx: speed, vy: 0, vz: 0, grounded: true, crouch: false, ...extra });
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('rifle spread blends from 0.15° standing to 2.5° at run speed', () => {
  assert.ok(close(spreadDegrees('rifle', mover(0)), 0.15));
  assert.ok(close(spreadDegrees('rifle', mover(5.5)), 2.5));
  assert.ok(close(spreadDegrees('rifle', mover(2.75)), 1.325));
});

test('airborne spread is double the moving value, crouched is 0.8 of standing', () => {
  assert.ok(close(spreadDegrees('rifle', mover(0, { grounded: false })), 5));
  assert.ok(close(spreadDegrees('rifle', mover(1.8, { crouch: true })), 0.12));
});

test('seeded shot directions stay inside the spread cone and repeat exactly', () => {
  const m = mover(5.5); // 2.5° rifle spread
  const aim = aimDir(0.3, 0.1);
  for (let shot = 1; shot <= 200; shot++) {
    const [d] = shotDirs(0.3, 0.1, 'rifle', m, shotRng(42, 1, shot));
    const angle = (Math.acos(Math.min(1, d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2])) * 180) / Math.PI;
    assert.ok(angle <= 2.5 + 1e-9, `shot ${shot} strayed ${angle}°`);
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12, 'unit length');
  }
  assert.deepEqual(shotDirs(0.3, 0.1, 'rifle', m, shotRng(42, 1, 9)), shotDirs(0.3, 0.1, 'rifle', m, shotRng(42, 1, 9)));
});

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

const pistol = (fire) => ({ keys: 0, fire, slot: 1 });

test('the pistol fires once per click, never on a held trigger', () => {
  const a = createArsenal('rifle');
  shots(a, pistol(false), 30); // switch to the pistol and let the switch finish
  assert.equal(shots(a, pistol(true), 120), 1, 'holding fires one shot');
});

test('clicking as fast as possible is capped at 6.75 pistol shots per second', () => {
  const a = createArsenal('rifle');
  shots(a, pistol(false), 30);
  a.mags[1] = 1000;
  let n = 0;
  for (let i = 0; i < 600; i++) if (stepWeapon(a, pistol(i % 2 === 0))) n++; // a click every other step
  assert.ok(n === 67 || n === 68, `${n} shots in 10 s`);
});

test('switching weapons blocks firing for 0.4 s and cancels a reload', () => {
  const a = createArsenal('rifle');
  shots(a, pistol(false), 30); // draw the pistol
  shots(a, pistol(true), 1);
  stepWeapon(a, { ...pistol(false), keys: KEY.RELOAD }); // start reloading the pistol
  assert.ok(a.reload > 0);
  let steps = 0;
  while (!stepWeapon(a, hold) && steps < 100) steps++; // switch to the rifle, trigger held
  assert.equal(steps, 24, 'the first rifle shot comes 0.4 s after the switch');
  assert.equal(a.mags[1], 11, 'the pistol reload was cancelled');
});

test('each weapon keeps its own magazine', () => {
  const a = createArsenal('rifle');
  shots(a, hold, 30); // 5 rifle shots
  shots(a, pistol(false), 30);
  shots(a, pistol(true), 1);
  shots(a, idle, 30); // back to the rifle
  assert.deepEqual(a.mags, [20, 11]);
});

test('the shotgun fires 12 pellets inside a 3.5° cone, standing or running', () => {
  for (const speed of [0, 5.5]) {
    let widest = 0;
    for (let shot = 1; shot <= 50; shot++) {
      const dirs = shotDirs(0, 0, 'shotgun', mover(speed), shotRng(7, 1, shot));
      assert.equal(dirs.length, 12);
      for (const d of dirs) widest = Math.max(widest, (Math.acos(Math.min(1, -d[2])) * 180) / Math.PI);
    }
    assert.ok(widest <= 3.5 + 1e-9 && widest > 3.3, `widest pellet ${widest}°`);
  }
});

test('the shotgun pumps at 1.1 shots per second and holds 5 shells', () => {
  const a = createArsenal('shotgun');
  let n = 0;
  for (let i = 0; i < 600 && a.mags[0] > 0; i++) if (stepWeapon(a, { ...hold, fire: i % 2 === 0 })) n++;
  assert.equal(n, 5);
  const b = createArsenal('shotgun');
  b.mags[0] = 1000;
  let m = 0;
  for (let i = 0; i < 600; i++) if (stepWeapon(b, { ...hold, fire: i % 2 === 0 })) m++;
  assert.ok(m === 11 || m === 12, `${m} pumps in 10 s`);
});

test('the shotgun reloads one shell every 0.5 s until full', () => {
  const a = createArsenal('shotgun');
  a.mags[0] = 0;
  stepWeapon(a, { ...idle, keys: KEY.RELOAD });
  shots(a, idle, 30);
  assert.equal(a.mags[0], 1);
  shots(a, idle, 120);
  assert.equal(a.mags[0], 5);
  assert.equal(a.reload, 0);
});

test('firing interrupts a shell-by-shell reload', () => {
  const a = createArsenal('shotgun');
  a.mags[0] = 0;
  stepWeapon(a, { ...idle, keys: KEY.RELOAD });
  shots(a, idle, 60); // two shells in
  assert.equal(stepWeapon(a, hold), true);
  assert.equal(a.reload, 0);
  assert.equal(a.mags[0], 1);
});

test('a shotgun pellet does 10 out to 8 m, falling to 2 from 18 m on: a full close blast kills 100 HP but not a Shield', () => {
  assert.equal(damageAt('shotgun', false, 5), 10);
  assert.equal(damageAt('shotgun', false, 8), 10);
  assert.ok(close(damageAt('shotgun', false, 13), 6));
  assert.ok(close(damageAt('shotgun', false, 40), 2));
  assert.equal(damageAt('shotgun', true, 5), 20);
  assert.equal(12 * damageAt('shotgun', false, 4), 120);
});

test('the pistol does 26 out to 25 m, falling to 19.5 from 40 m on', () => {
  assert.equal(damageAt('pistol', false, 25), 26);
  assert.ok(close(damageAt('pistol', false, 40), 19.5));
  assert.ok(close(damageAt('pistol', false, 60), 19.5));
});

test('every rifle headshot does a flat 160, at any range', () => {
  for (const d of [2, 20, 40, 50]) assert.equal(damageAt('rifle', true, d), 160, `${d} m`);
});

test('a rifle body hit does 30 out to 20 m, falling to 24 from 30 m on', () => {
  assert.equal(damageAt('rifle', false, 2), 30);
  assert.equal(damageAt('rifle', false, 20), 30);
  assert.ok(close(damageAt('rifle', false, 25), 27));
  assert.ok(close(damageAt('rifle', false, 35), 24));
});

// The heat each shot of a held rifle spray fires with.
const sprayHeats = (a, steps) => {
  const out = [];
  for (let i = 0; i < steps; i++) if (stepWeapon(a, hold)) out.push(shotHeat(a));
  return out;
};

test('a rifle spray heats up: the first shot fires cold, the second 6 steps later with 1 - 6 × 4/60 = 0.6', () => {
  const [first, second] = sprayHeats(createArsenal('rifle'), 7);
  assert.equal(first, 0);
  assert.ok(close(second, 0.6), `second shot heat ${second}`);
});

test('a long spray tops out at heat 8, a 2.15° cone, and cools from there at once', () => {
  const a = createArsenal('rifle');
  const heats = sprayHeats(a, 150);
  assert.equal(heats.length, 25, 'the whole magazine');
  assert.ok(close(Math.max(...heats), 8), `hottest shot ${Math.max(...heats)}`);
  assert.ok(close(spreadDegrees('rifle', mover(0), Math.max(...heats)), 2.15));
  const before = a.heat;
  stepWeapon(a, idle);
  assert.ok(close(before - a.heat, 4 / 60), 'one idle step cools 4/60');
});

test('prediction parity: two arsenals stepped with the same inputs stay identical, heat included, across a snapshot copy', () => {
  const server = createArsenal('rifle');
  const client = createArsenal('rifle');
  const inputs = Array.from({ length: 400 }, (_, i) => ({
    keys: i % 97 === 50 ? KEY.RELOAD : 0,
    fire: i % 11 < 7,
    slot: i > 250 && i < 320 ? 1 : 0,
  }));
  inputs.forEach((inp, i) => {
    stepWeapon(server, inp);
    stepWeapon(client, inp);
    if (i === 40) Object.assign(client, JSON.parse(JSON.stringify(server))); // a reconcile mid-spray
  });
  assert.deepEqual(client, server);
});

test('a switch keeps the heat, which cools at 4 a second whatever is held, so a quick switch back is no cold tap', () => {
  const a = createArsenal('rifle');
  sprayHeats(a, 30);
  const hot = a.heat;
  assert.ok(hot > 2);
  for (let i = 0; i < 15; i++) stepWeapon(a, pistol(false)); // 0.25 s on the pistol
  assert.ok(close(a.heat, hot - 15 * DT * 4, 1e-9), `heat ${a.heat} after 0.25 s on the pistol`);
  for (let i = 0; i < 15; i++) stepWeapon(a, { fire: false, reload: false, slot: 0 }); // and 0.25 s back on the rifle
  assert.ok(close(a.heat, hot - 30 * DT * 4, 1e-9), 'still warm: only time cools a spray');
});

test('heat blooms the rifle cone by 0.25° each, standing, crouched, running or airborne', () => {
  assert.ok(close(spreadDegrees('rifle', mover(0), 4), 1.15));
  assert.ok(close(spreadDegrees('rifle', mover(0, { crouch: true }), 4), 1.12));
  assert.ok(close(spreadDegrees('rifle', mover(5.5), 4), 3.5));
  assert.ok(close(spreadDegrees('rifle', mover(0, { grounded: false }), 4), 6));
  assert.ok(close(spreadDegrees('shotgun', mover(0), 4), 3.5), 'no bloom on the shotgun');
  assert.ok(close(spreadDegrees('rifle', mover(0), 9), 2.15), 'bloom tops out at 2°, even at the stored heat cap the crosshair reads');
  const m = mover(0);
  const aim = aimDir(0, 0);
  let widest = 0;
  for (let shot = 1; shot <= 200; shot++) {
    const [d] = shotDirs(0, 0, 'rifle', m, shotRng(42, 1, shot), 4);
    widest = Math.max(widest, (Math.acos(Math.min(1, d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2])) * 180) / Math.PI);
  }
  assert.ok(widest <= 1.15 + 1e-9 && widest > 1, `the shot cone follows the heat: widest ${widest}°`);
});

test('a fresh life starts grounded at the spawn with full HP, magazines and the primary drawn', () => {
  const life = freshLife(1, 1.2, -3, 'shotgun');
  assert.deepEqual([life.mover.x, life.mover.y, life.mover.z, life.mover.grounded], [1, 1.2, -3, true]);
  assert.deepEqual([life.hp, life.alive], [100, true]);
  assert.deepEqual([life.arsenal.primary, life.arsenal.slot, life.arsenal.mags], ['shotgun', 0, [5, 12]]);
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

// ---- Through the server: a real Game with fake sockets ----

// Alice at the origin facing Bob, dist metres away down -z, both standing,
// spawn protection over, Bob with HP to spare so every hit shows.
async function duel(primary, dist) {
  const { Game } = await import('../server/game.js');
  const game = new Game('flat', { boxes: [{ pos: [0, -0.5, 0], size: [200, 1, 200] }], spawns: [[0, 0, 0], [0, 0, -dist]] });
  game.seed = 1234; // every shot's spread repeats
  const [a, b] = ['Alice', 'Bob'].map((name) => {
    const conn = { out: [], ws: { readyState: 1, OPEN: 1, bufferedAmount: 0, send: (d) => conn.out.push(JSON.parse(d)), terminate() {} } };
    game.handle(conn, { t: 'join', name, bot: false });
    game.handle(conn, { t: 'loadout', primary });
    return conn.player;
  });
  game.handle(a.conn, { t: 'start' });
  for (const [p, z] of [[a, 0], [b, -dist]]) {
    Object.assign(p.mover, { x: 0, y: 0, z, vx: 0, vy: 0, vz: 0, grounded: true, crouch: false });
    p.protectedUntil = 0;
  }
  b.hp = 1000;
  game.step(); // the rewind history records where they stand
  let s = 0;
  // Alice holds the trigger at height y on Bob for n ticks; returns her hit events.
  const fire = (y, n = 1) => {
    const from = a.conn.out.length;
    for (let i = 0; i < n; i++) {
      for (let k = i ? 1 : 2; k > 0; k--) {
        s++;
        game.handle(a.conn, { t: 'input', s, rt: game.tick, keys: 0, yaw: 0, pitch: Math.atan2(y - 1.6, dist), fire: true, shot: s, slot: 0 });
      }
      game.step();
    }
    return a.conn.out.slice(from).filter((m) => m.t === 'event' && m.e === 'hit');
  };
  return { game, a, b, fire };
}

test('server: a rifle body hit at 23 m lands as a whole 28, not 28.4 (falloff from the body face at 22.7 m)', async () => {
  const { b, fire } = await duel('rifle', 23);
  const [hit] = fire(1.0);
  assert.deepEqual([hit.dmg, hit.head], [28, false]);
  assert.equal(b.hp, 1000 - 28);
});

test('server: a shotgun blast is a headshot only when most of its landed pellets hit the head', async () => {
  // Seed 1234, shot 1: at 2 m, aiming at 1.55 m puts 5 of 12 pellets in the head (5 × 20 + 7 × 10).
  assert.deepEqual((await duel('shotgun', 2)).fire(1.55).map((h) => [h.dmg, h.head]), [[170, false]]);
  // At 3 m, aiming at 1.65 m lands 11 pellets, 10 in the head (10 × 20 + 10).
  assert.deepEqual((await duel('shotgun', 3)).fire(1.65).map((h) => [h.dmg, h.head]), [[210, true]]);
  // Point-blank on the head: all 12.
  assert.deepEqual((await duel('shotgun', 2)).fire(1.65).map((h) => [h.dmg, h.head]), [[240, true]]);
});

test('server: a held rifle spray at a head 30 m away does 160 on every head hit, while the bloom scatters the later bullets', async () => {
  const { b, fire } = await duel('rifle', 30);
  b.hp = 1e6; // soaks the whole magazine
  const hits = fire(1.65, 150).map((h) => [h.dmg, h.head]);
  assert.deepEqual(hits.slice(0, 3), [[160, true], [160, true], [160, true]], 'mid-spray headshots stay 160');
  for (const [dmg, head] of hits) assert.equal(dmg, head ? 160 : 24);
  const heads = hits.filter(([, head]) => head).length;
  assert.ok(heads < 20, `the bloom keeps a 25-round spray off the head: ${heads} head hits`);
});

// ---- arsenal: two guns per player, one per slot ----

test('an arsenal holds a primary and a sidearm, each with its own magazine; weaponOf names the held one', () => {
  const a = createArsenal('shotgun', 'handcannon');
  assert.deepEqual([a.primary, a.secondary, a.mags], ['shotgun', 'handcannon', [5, GUNS.handcannon.mag]]);
  assert.equal(weaponOf(a), 'shotgun');
  shots(a, { keys: 0, fire: false, slot: 1 }, 30);
  assert.equal(weaponOf(a), 'handcannon');
  assert.equal(shots(a, { keys: 0, fire: true, slot: 1 }, 1), 1);
  assert.equal(a.mags[1], GUNS.handcannon.mag - 1);
  assert.equal(createArsenal('rifle').secondary, 'pistol', 'the sidearm defaults to the pistol');
  const life = freshLife(0, 0, 0, 'rifle', 'handcannon');
  assert.deepEqual([life.arsenal.primary, life.arsenal.secondary], ['rifle', 'handcannon']);
});

test('the sidearm fires at its own rate: a semi gun clicked every other step is capped by its rps', () => {
  const a = createArsenal('rifle', 'handcannon');
  shots(a, { keys: 0, fire: false, slot: 1 }, 30);
  a.mags[1] = 1000;
  let n = 0;
  for (let i = 0; i < 600; i++) if (stepWeapon(a, { keys: 0, fire: i % 2 === 0, slot: 1 })) n++;
  // Click every 2 steps against a cooldown of 60 / rps steps: one shot per ceil-to-even interval.
  const expected = Math.floor(600 / (2 * Math.ceil(60 / GUNS.handcannon.rps / 2)));
  assert.ok(Math.abs(n - expected) <= 1, `${n} shots in 10 s, expected about ${expected}`);
});

// ---- arsenal: burst mode ----

// Steps an arsenal through clicks (fire on one step, released the next) or a
// held trigger; returns the steps each shot fired on.
const shotSteps = (a, fireAt, steps, slot = 0) => {
  const out = [];
  for (let i = 0; i < steps; i++) if (stepWeapon(a, { keys: 0, fire: fireAt(i), slot })) out.push(i);
  return out;
};

test('burst: one click fires burst.count shots at burst.rps, the cooldown carrying its remainder; holding fires one burst', () => {
  const { count, rps } = GUNS.burst.burst;
  // The cooldown runs down on the firing step too, so shot k comes on step ceil(60k / rps - 1).
  const expected = Array.from({ length: count }, (_, k) => (k ? Math.ceil((k * 60) / rps - 1 - 1e-9) : 0));
  assert.deepEqual(shotSteps(createArsenal('burst'), (i) => i === 0, 120), expected, 'a one-step click');
  assert.deepEqual(shotSteps(createArsenal('burst'), () => true, 120), expected, 'a held trigger: one burst, no more');
});

test('burst: clicking as fast as possible starts a burst every count / burst.rps + delay seconds', () => {
  const { count, rps, delay } = GUNS.burst.burst;
  const a = createArsenal('burst');
  a.mags[0] = 1000;
  const fired = shotSteps(a, (i) => i % 2 === 0, 600);
  const cycle = count / rps + delay;
  const due = Math.ceil(cycle * 60 - 1 - 1e-9);
  assert.equal(fired[count], due + (due % 2), 'the second burst starts on the first click (even steps) after the delay');
  assert.ok(Math.abs(fired.length / 10 - GUNS.burst.rps) < 0.35, `${fired.length / 10} shots/s, rps says ${GUNS.burst.rps}`);
  assert.ok(Math.abs(GUNS.burst.rps - count / cycle) < 0.01, 'rps is the sustained rate the burst numbers give');
});

test('burst: a switch or a power-up gun lock cancels the rest of a burst; a burst stops at an empty magazine', () => {
  const a = createArsenal('burst');
  assert.deepEqual(shotSteps(a, (i) => i === 0, 2).length, 1);
  stepWeapon(a, { keys: 0, fire: false, slot: 1 }); // to the sidearm mid-burst
  shotSteps(a, () => false, 30, 1);
  assert.deepEqual(shotSteps(a, () => false, 60, 0).length, 0, 'switching back does not resume it');

  const b = createArsenal('burst');
  shotSteps(b, (i) => i === 0, 2);
  b.switching = 0.25; // what stepPowers does on a use
  assert.equal(shotSteps(b, () => false, 60).length, 0, 'the lock ended the burst');

  const c = createArsenal('burst');
  c.mags[0] = 2;
  assert.equal(shotSteps(c, (i) => i === 0, 60).length, 2);
  assert.equal(c.reload, 0, 'running dry mid-burst does not reload by itself');
  shotSteps(c, (i) => i === 0, 1);
  assert.ok(c.reload > 0, 'the next click reloads');
});

test('burst: R mid-burst reloads and drops the rest of the burst', () => {
  const a = createArsenal('burst');
  shotSteps(a, (i) => i === 0, 2);
  stepWeapon(a, { keys: KEY.RELOAD, fire: false, slot: 0 });
  assert.ok(a.reload > 0);
  shotSteps(a, () => false, Math.round(GUNS.burst.reload * 60) + 2);
  assert.equal(a.mags[0], GUNS.burst.mag);
  assert.equal(shotSteps(a, () => false, 60).length, 0);
});

// ---- arsenal: scopes ----

const aimHeld = (slot = 0, fire = false) => ({ keys: KEY.AIM, fire, slot });

test('scope: holding AIM scopes the sniper in after scope.inSeconds, its cone narrowing to the scoped spread; letting go drops it at once', () => {
  const { scope, spreadStand } = GUNS.sniper;
  const a = createArsenal('sniper');
  const steps = Math.ceil(scope.inSeconds * 60 - 1e-9);
  for (let i = 1; i < steps; i++) stepWeapon(a, aimHeld());
  assert.equal(scopedIn(a), false, 'not yet');
  assert.ok(scopeShare(a) > 0.8 && scopeShare(a) < 1, `share ${scopeShare(a)} on the way in`);
  stepWeapon(a, aimHeld());
  assert.equal(scopedIn(a), true, `in after ${steps} steps`);
  assert.equal(scopeShare(a), 1);
  assert.ok(close(spreadDegrees('sniper', mover(0), 0, true), scope.spread));
  assert.ok(close(spreadDegrees('sniper', mover(5.5), 0, true), scope.moveSpread));
  assert.ok(close(spreadDegrees('sniper', mover(0), 0, false), spreadStand), 'unscoped: the wide hip cone');
  assert.ok(spreadStand > 5 * scope.spread, 'inaccurate unscoped');
  stepWeapon(a, idle);
  assert.deepEqual([scopedIn(a), scopeShare(a)], [false, 0]);
});

test('scope: guns without one ignore AIM; a switch or a reload drops the scope, and it cannot come in while reloading', () => {
  const r = createArsenal('rifle');
  for (let i = 0; i < 60; i++) stepWeapon(r, aimHeld());
  assert.deepEqual([scopedIn(r), scopeShare(r)], [false, 0]);
  assert.ok(close(spreadDegrees('rifle', mover(0), 0, true), 0.15), 'a scoped flag on an unscoped gun changes nothing');

  const a = createArsenal('sniper');
  for (let i = 0; i < 30; i++) stepWeapon(a, aimHeld());
  assert.equal(scopedIn(a), true);
  stepWeapon(a, aimHeld(1));
  assert.equal(scopeShare(a), 0, 'switching to the sidearm');
  for (let i = 0; i < 60; i++) stepWeapon(a, aimHeld(0));
  assert.equal(scopedIn(a), true, 'back on the sniper, still holding AIM: in again');
  stepWeapon(a, aimHeld(0, true)); // fire one
  stepWeapon(a, { keys: KEY.AIM | KEY.RELOAD, fire: false, slot: 0 });
  stepWeapon(a, aimHeld());
  assert.equal(scopeShare(a), 0, 'reloading');
  for (let i = 0; i < 30; i++) stepWeapon(a, aimHeld());
  assert.equal(scopeShare(a), 0, 'still reloading');
});

test('scope: the sniper bolts every 0.75 s and a scoped body hit does 150, a kill from 100 HP but not through a Shield', () => {
  const a = createArsenal('sniper');
  a.mags[0] = 1000;
  for (let i = 0; i < 30; i++) stepWeapon(a, aimHeld());
  const fired = shotSteps(a, (i) => i % 2 === 0, 600);
  assert.ok(Math.abs(1 / GUNS.sniper.rps - 0.75) < 0.01, 'about 0.75 s a bolt');
  assert.equal(fired.length, Math.ceil(600 / (2 * Math.ceil((60 / GUNS.sniper.rps - 1) / 2 - 1e-9))), `${fired.length} bolts in 10 s`);
  assert.deepEqual([GUNS.sniper.mag, damageAt('sniper', false, 40)], [5, 150]);
  assert.ok(damageAt('sniper', false, 40) >= 100 && damageAt('sniper', false, 40) < 160);
});

test('scope: a scoped shot rolls the scoped cone on both sides', () => {
  const m = mover(0);
  const aim = aimDir(0, 0);
  let widest = 0;
  for (let shot = 1; shot <= 200; shot++) {
    const [d] = shotDirs(0, 0, 'sniper', m, shotRng(5, 1, shot), 0, true);
    widest = Math.max(widest, (Math.acos(Math.min(1, d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2])) * 180) / Math.PI);
  }
  assert.ok(widest <= GUNS.sniper.scope.spread + 1e-9, `widest ${widest}°`);
});

test('moveFactor: the held gun sets the pace, a scope slows it more, and a gun with fireSpeed slows while it cycles', () => {
  const a = createArsenal('rifle', 'pistol');
  assert.equal(moveFactor(a), 1, 'the launch guns run at full speed');
  const s = createArsenal('sniper');
  assert.equal(moveFactor(s), GUNS.sniper.speed);
  for (let i = 0; i < 30; i++) stepWeapon(s, aimHeld());
  assert.ok(close(moveFactor(s), GUNS.sniper.speed * GUNS.sniper.scope.speed));
  stepWeapon(s, aimHeld(0, true));
  assert.ok(close(moveFactor(s), GUNS.sniper.speed * GUNS.sniper.scope.speed * GUNS.sniper.fireSpeed), 'the bolt cycling');
  for (let i = 0; i < 50; i++) stepWeapon(s, idle);
  assert.equal(moveFactor(s), GUNS.sniper.speed, 'cycled and unscoped');
});

// arsenal: scope and pace through a real Game, as the client predicts them.
test('server: a scoped Surveyor body shot at 40 m kills from 100 HP; from the hip it mostly misses', async () => {
  const { game, a, b } = await duel('sniper', 40);
  let s = 0;
  const send = (keys, fire, y = 1.0) => {
    s++;
    game.handle(a.conn, { t: 'input', s, rt: game.tick, keys, yaw: 0, pitch: Math.atan2(y - 1.6, 40), fire, shot: s, slot: 0 });
    game.step();
  };
  b.hp = 100;
  for (let i = 0; i < 20; i++) send(KEY.AIM, false); // scope in (with a tick of buffer)
  send(KEY.AIM, true);
  send(KEY.AIM, false);
  assert.equal(b.alive, false, 'one scoped body shot');

  const hip = await duel('sniper', 40);
  let hits = 0;
  for (let k = 0; k < 20; k++) {
    for (let i = 0; i < 50; i++) {
      s = (hip.s ?? 0) + 1;
      hip.s = s;
      hip.game.handle(hip.a.conn, { t: 'input', s, rt: hip.game.tick, keys: 0, yaw: 0, pitch: Math.atan2(1.0 - 1.6, 40), fire: i === 0, shot: s, slot: 0 });
      const before = hip.b.hp;
      hip.game.step();
      if (hip.b.hp < before) hits++;
    }
  }
  assert.ok(hits <= 6, `${hits} of 20 hip shots landed at 40 m`);
});

test('server: the held gun sets the pace: a scoped Surveyor walks at speed × scope.speed of 5.5 m/s', async () => {
  const { game, a } = await duel('sniper', 10);
  let s = 0;
  const z0 = [];
  for (let i = 0; i < 120; i++) {
    s++;
    game.handle(a.conn, { t: 'input', s, rt: game.tick, keys: KEY.BACK | KEY.AIM, yaw: 0, pitch: 0, fire: false, shot: s, slot: 0 });
    game.step();
    if (i === 59) z0.push(a.mover.z);
  }
  const speed = a.mover.z - z0[0];
  assert.ok(Math.abs(speed - 5.5 * GUNS.sniper.speed * GUNS.sniper.scope.speed) < 0.05, `${speed} m in the second second`);
});

test('prediction parity: mover and arsenal stepped together (pace, scope, bursts) stay identical across a snapshot copy', async () => {
  const { step } = await import('./movement.js');
  const boxes = prepareMap({ boxes: [{ pos: [0, -0.5, 0], size: [100, 1, 100] }], spawns: [] }).boxes;
  for (const [primary, secondary] of [['sniper', 'handcannon'], ['burst', 'pistol']]) {
    const server = freshLife(0, 0, 0, primary, secondary);
    const client = freshLife(0, 0, 0, primary, secondary);
    const rand = shotRng(9, 9, 9);
    for (let i = 0; i < 600; i++) {
      const inp = { keys: (rand() < 0.6 ? KEY.FORWARD : 0) | (rand() < 0.5 ? KEY.AIM : 0) | (rand() < 0.02 ? KEY.RELOAD : 0), yaw: i * 0.01, pitch: 0, fire: rand() < 0.3, slot: i % 200 < 170 ? 0 : 1 };
      for (const life of [server, client]) {
        step(life.mover, inp, boxes, moveFactor(life.arsenal));
        stepWeapon(life.arsenal, inp);
      }
      if (i === 300) Object.assign(client, JSON.parse(JSON.stringify(server)));
    }
    assert.deepEqual(client, server, primary);
  }
});
