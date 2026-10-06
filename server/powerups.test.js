// The power-up server, driven through a real Game with fake sockets. With
// no inputs queued, every player takes a neutral step each tick and stands
// still, so positions are set by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game } from './game.js';
import { KEY } from '../shared/movement.js';
import { POWERUPS, TICK_RATE, DT, MAX_HP, RUN_SPEED } from '../shared/constants.js';
import { padsFor } from '../shared/powerups.js';
import { readEntity } from '../shared/protocol.js';

const arena = JSON.parse(await readFile(new URL('../shared/maps/arena_01.json', import.meta.url)));
const flat = { boxes: [{ pos: [0, -0.5, 0], size: [200, 1, 200] }], spawns: [[0, 0, 0], [30, 0, 0], [60, 0, 0], [90, 0, 0]] };

// A running match with one player per [x, z] spot, spawn protection over,
// everyone facing -z. Returns the game, its players and their sockets.
function match(spots, mapId = 'flat', map = flat) {
  const game = new Game(mapId, map);
  const players = spots.map((_, i) => {
    const sent = [];
    const conn = { ws: { readyState: 1, OPEN: 1, bufferedAmount: 0, send: (d) => sent.push(d), terminate() {} }, sent };
    game.handle(conn, { t: 'join', name: `p${i + 1}`, bot: false });
    return conn.player;
  });
  game.handle(players[0].conn, { t: 'start' });
  spots.forEach(([x, z], i) => {
    Object.assign(players[i].mover, { x, y: 0, z, vx: 0, vy: 0, vz: 0, grounded: true });
    Object.assign(players[i], { protectedUntil: 0, yaw: 0, pitch: 0 });
  });
  return { game, players };
}

const run = (game, seconds) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) game.step(); };
const messages = (p) => p.conn.sent.map((d) => JSON.parse(d));
const events = (p, e) => messages(p).filter((m) => m.t === 'event' && m.e === e);

test('running onto a pad collects it, and the pad refills after its respawn time', () => {
  const [x, , z, kind] = padsFor('arena_01')[0];
  const { game, players: [p] } = match([[x, z]], 'arena_01', arena);
  game.step();
  assert.deepEqual(p.inv, [kind]);
  assert.deepEqual(events(p, 'pickup').map((m) => [m.id, m.pad, m.k]), [[p.id, 0, kind]]);
  p.inv = [];
  run(game, POWERUPS[kind].respawn - 0.1);
  assert.deepEqual(p.inv, []); // still standing on it, but it is empty
  run(game, 0.2);
  assert.deepEqual(p.inv, [kind]);
});

test('full slots leave the pad for the next player through it', () => {
  const [x, , z, kind] = padsFor('arena_01')[0];
  const { game, players: [full, other] } = match([[x, z], [x + 0.3, z]], 'arena_01', arena);
  full.inv = ['mine', 'mine', 'mine'];
  game.step();
  assert.deepEqual(full.inv, ['mine', 'mine', 'mine']);
  assert.deepEqual(other.inv, [kind]);
});

test('use on an input fires the first power-up on that very step: Nitro speeds the server mover at once', () => {
  const { game, players: [p] } = match([[0, 0]]);
  p.inv = ['nitro', 'mine'];
  const input = (s, keys) => ({ t: 'input', s, rt: 0, keys, yaw: 0, pitch: 0, fire: false, shot: 0, slot: 0 });
  p.receive(input(1, KEY.FORWARD | KEY.USE), performance.now());
  p.receive(input(2, KEY.FORWARD), performance.now());
  game.step(); // the jitter buffer holds one: input 1 runs
  assert.equal(p.ack, 1);
  assert.deepEqual(p.inv, ['mine']);
  assert.ok(Math.abs(p.mover.boost - (POWERUPS.nitro.seconds - DT)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(p.mover.vx, p.mover.vz) - Math.min(RUN_SPEED * POWERUPS.nitro.speed, 50 * DT)) < 1e-9);
  assert.deepEqual(events(p, 'powerup').map((m) => [m.id, m.k]), [[p.id, 'nitro']]);
});

test('a Shunt homes onto an enemy off to the side, and its kill is credited and named', () => {
  const { game, players: [shooter, target] } = match([[0, 0], [5, -12]]); // 23° off the aim
  target.hp = 50;
  game.powerups.use(shooter, 'shunt', { yaw: 0, pitch: 0 });
  run(game, 3);
  assert.equal(target.alive, false);
  assert.equal(shooter.kills, 1);
  const [kill] = events(shooter, 'kill');
  assert.deepEqual([kill.k, kill.v, kill.w], [shooter.id, target.id, 'shunt']);
  assert.deepEqual(events(target, 'blast').map((m) => m.k), ['shunt']);
  assert.equal(game.powerups.ents.length, 0);
});

test('a Shunt with nobody in its cone flies straight and bursts at the end of its life', () => {
  const { game, players: [shooter, bystander] } = match([[0, 0], [40, 0]]); // 90° off the aim
  game.powerups.use(shooter, 'shunt', { yaw: 0, pitch: 0 });
  run(game, POWERUPS.shunt.life - 0.1);
  const [e] = game.powerups.ents;
  assert.ok(Math.abs(e.x) < 1e-9 && e.z < -70, `at ${e.x}, ${e.z}`);
  run(game, 0.2);
  assert.equal(game.powerups.ents.length, 0);
  assert.equal(bystander.hp, MAX_HP);
});

test('Bolt fires three bolts a moment apart, each a direct hit', () => {
  const { game, players: [shooter, target] } = match([[0, 0], [0, -10]]);
  game.powerups.use(shooter, 'bolt', { yaw: 0, pitch: 0 });
  game.step();
  assert.equal(game.powerups.ents.length, 1); // the next two follow
  run(game, 1);
  assert.equal(events(target, 'blast').filter((m) => m.k === 'bolt').length, 3);
  assert.equal(target.alive, false); // 3 x 34 > 100
  assert.equal(events(target, 'kill')[0].w, 'bolt');
});

test('Barge throws nearby enemies away, less the further they stand, and spares the user and anyone out of range', () => {
  const { game, players: [user, near, mid, far] } = match([[0, 0], [2, 0], [5, 0], [9, 0]]);
  game.powerups.use(user, 'barge', { yaw: 0, pitch: 0 });
  assert.ok(near.mover.kx > mid.mover.kx && mid.mover.kx > 0, `${near.mover.kx} ${mid.mover.kx}`);
  assert.ok(near.mover.vy > mid.mover.vy && mid.mover.vy > 0);
  assert.ok(near.hp < mid.hp && mid.hp < MAX_HP, `${near.hp} ${mid.hp}`);
  assert.deepEqual([far.hp, far.mover.kx, far.mover.vy], [MAX_HP, 0, 0]);
  assert.deepEqual([user.hp, user.mover.kx, user.mover.vy], [MAX_HP, 0, 0]);
  run(game, 1.5);
  assert.ok(near.mover.x > 6, `thrown to x=${near.mover.x}`);
});

test('a dropped Mine falls to the floor, arms, ignores its owner, then goes off under an enemy', () => {
  const { game, players: [owner, enemy] } = match([[0, 0], [10, 0]]);
  owner.mover.y = 2; // in mid-air
  game.powerups.use(owner, 'mine', { yaw: 0, pitch: 0 });
  run(game, 0.5);
  const [mine] = game.powerups.ents;
  assert.deepEqual([mine.y, mine.armed], [0, false]);
  enemy.mover.x = 0.5; // stepping on it before it arms is safe
  run(game, 0.3);
  assert.equal(enemy.hp, MAX_HP);
  enemy.mover.x = 10;
  run(game, 1); // armed now; its owner standing on it does nothing
  assert.equal(mine.armed, true);
  assert.equal(game.powerups.ents.length, 1);
  enemy.mover.x = 0.25; // right on top of it: the full splash
  game.step();
  assert.equal(game.powerups.ents.length, 0);
  assert.equal(enemy.hp, MAX_HP - POWERUPS.mine.splash);
  assert.ok(enemy.mover.vy > 0);
  assert.equal(owner.hp, MAX_HP);
});

test('a player keeps at most three mines down; the oldest goes', () => {
  const { game, players: [p] } = match([[0, 0]]);
  for (let i = 0; i < POWERUPS.mine.max + 1; i++) game.powerups.use(p, 'mine', { yaw: 0, pitch: 0 });
  assert.deepEqual(game.powerups.ents.map((e) => e.id), [2, 3, 4]);
});

test('Shield soaks damage before HP until spent or expired; Repair heals up to full', () => {
  const { game, players: [a, b] } = match([[0, 0], [5, 0]]);
  game.powerups.use(b, 'shield', { yaw: 0, pitch: 0 });
  game.damage(a, b, 40, false, 'rifle');
  assert.deepEqual([b.hp, b.shield], [MAX_HP, POWERUPS.shield.hp - 40]);
  game.damage(a, b, 40, false, 'rifle');
  assert.deepEqual([b.hp, b.shield], [MAX_HP - (80 - POWERUPS.shield.hp), 0]);
  game.powerups.use(b, 'repair', { yaw: 0, pitch: 0 });
  assert.equal(b.hp, MAX_HP);
  game.powerups.use(b, 'shield', { yaw: 0, pitch: 0 });
  run(game, POWERUPS.shield.seconds + 0.1);
  assert.equal(b.shield, 0);
});

test('spawn protection keeps a player out of every blast', () => {
  const { game, players: [user, fresh] } = match([[0, 0], [2, 0]]);
  fresh.protectedUntil = game.tick + 600;
  game.powerups.use(user, 'barge', { yaw: 0, pitch: 0 });
  assert.deepEqual([fresh.hp, fresh.mover.kx, fresh.mover.vy], [MAX_HP, 0, 0]);
});

test('snapshots carry the slots, the shield, the pads and the entities', () => {
  const { game, players: [p, q] } = match([[0, 0], [20, 0]]);
  p.inv = ['bolt', 'repair'];
  game.powerups.use(q, 'shield', { yaw: 0, pitch: 0 });
  game.powerups.use(q, 'mine', { yaw: 0, pitch: 0 });
  game.step();
  const snap = messages(p).filter((m) => m.t === 'snapshot').at(-1);
  assert.deepEqual([snap.me.inv, snap.me.shield], [['bolt', 'repair'], 0]);
  assert.deepEqual(snap.pu.pads, []);
  const [mine] = snap.pu.ents.map(readEntity);
  assert.deepEqual([mine.kind, mine.owner, mine.x, mine.armed], ['mine', q.id, 20, false]);
  const qEntry = snap.ps.find(([id]) => id === q.id);
  assert.ok(qEntry[6] & 16, 'PU_SHIELD flag');
});

test('a new match refills every pad and clears the air and the slots', () => {
  const [x, , z] = padsFor('arena_01')[0];
  const { game, players: [p] } = match([[x, z]], 'arena_01', arena);
  game.step();
  game.powerups.use(p, 'mine', { yaw: 0, pitch: 0 });
  game.endMatch();
  game.startMatch();
  assert.equal(game.powerups.pads[0].readyAt, 0);
  assert.deepEqual([game.powerups.ents, p.inv, p.shield], [[], [], 0]);
});

// The real client prediction (client/net.js) against the real server, over
// the JSON snapshot: every predicted step must equal the server's, Nitro
// included, except the few in flight when a knockback the client could not
// foresee lands; after that one reconcile, prediction is exact again.
test('client prediction matches the server step for step through Nitro, and re-converges after a knockback', async () => {
  const { self, predict, reconcile } = await import('../client/net.js');
  const { knock } = await import('../shared/powerups.js');
  const { game, players: [p] } = match([[0, 0]]);
  p.inv = ['nitro', 'mine'];
  Object.assign(self, { mover: structuredClone(p.mover), arsenal: structuredClone(p.arsenal), hp: p.hp, alive: true, inv: [...p.inv], pending: [], seq: 0, shots: 0 });
  const predicted = new Map(); // seq → the mover the client predicted after it, as JSON
  const wrong = [];
  for (let i = 1; i <= 300; i++) { // Nitro from input 5 to about 245, a knockback at 120
    const input = { keys: KEY.FORWARD | (i === 5 ? KEY.USE : 0) | (i % 40 === 0 ? KEY.JUMP : 0), yaw: 0.01 * i, pitch: 0, fire: false, slot: 0, rt: 0 };
    predict(input, game.map.boxes);
    predicted.set(input.s, JSON.stringify(self.mover));
    p.receive({ t: 'input', ...input }, performance.now());
    if (i === 120) knock(p.mover, 1, 0, 10, 5);
    game.step();
    const snap = messages(p).filter((m) => m.t === 'snapshot').at(-1);
    if (snap.ack && JSON.stringify(snap.me.mover) !== predicted.get(snap.ack)) wrong.push(snap.ack);
    reconcile(snap, game.map.boxes);
  }
  assert.ok(p.mover.boost === 0 && p.inv.length === 1, 'Nitro was used and has run out');
  assert.ok(wrong.length > 0 && wrong.length <= 2 && wrong.every((s) => s >= 118 && s <= 121), `mispredicted: ${wrong}`);
  assert.deepEqual(self.inv, p.inv);
});
