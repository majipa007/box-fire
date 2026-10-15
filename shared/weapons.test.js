import test from 'node:test';
import assert from 'node:assert/strict';
import { createArsenal, stepWeapon, traceShot, spreadDegrees, shotDirs, aimDir, damageAt, freshLife, shotHeat } from './weapons.js';
import { KEY } from './movement.js';
import { prepareMap } from './collision.js';
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

test('switching weapons clears the heat', () => {
  const a = createArsenal('rifle');
  sprayHeats(a, 30);
  assert.ok(a.heat > 2);
  stepWeapon(a, pistol(false));
  assert.equal(a.heat, 0);
});

test('heat blooms the rifle cone by 0.25° each, standing, crouched, running or airborne', () => {
  assert.ok(close(spreadDegrees('rifle', mover(0), 4), 1.15));
  assert.ok(close(spreadDegrees('rifle', mover(0, { crouch: true }), 4), 1.12));
  assert.ok(close(spreadDegrees('rifle', mover(5.5), 4), 3.5));
  assert.ok(close(spreadDegrees('rifle', mover(0, { grounded: false }), 4), 6));
  assert.ok(close(spreadDegrees('shotgun', mover(0), 4), 3.5), 'no bloom on the shotgun');
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
