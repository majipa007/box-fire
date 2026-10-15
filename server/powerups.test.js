// The power-up server (docs/bible.md §8.8), driven through a real Game with
// fake sockets. With no inputs queued, every player takes a neutral step
// each tick and stands still, so positions are set by hand; drive() feeds
// real inputs when a test needs someone to run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game } from './game.js';
import { KEY } from '../shared/movement.js';
import { MAX_HP, POWERS, TICK_RATE, HISTORY_TICKS } from '../shared/constants.js';
import { POWER_IDS, ENT, PLAYER_FLAGS } from '../shared/protocol.js';
import { eyeOf } from '../shared/weapons.js';

const arena = JSON.parse(await readFile(new URL('../shared/maps/arena_01.json', import.meta.url)));
const flat = { boxes: [{ pos: [0, -0.5, 0], size: [200, 1, 200] }], spawns: [[0, 0, 0], [30, 0, 0], [60, 0, 0], [90, 0, 0]] };
const wall = (x, z, w, d) => ({ pos: [x, 2, z], size: [w, 4, d] });

// A running match with one player per [x, z] spot, spawn protection over,
// everyone facing -z. Returns the game and its players.
function match(spots, mapId = 'flat', map = flat) {
  const game = new Game(mapId, map);
  const players = spots.map((_, i) => {
    const sent = [];
    const conn = { ws: { readyState: 1, OPEN: 1, bufferedAmount: 0, send: (d) => sent.push(d), terminate() {} }, sent };
    game.handle(conn, { t: 'join', name: `p${i + 1}`, bot: false });
    return conn.player;
  });
  game.handle(players[0].conn, { t: 'start' });
  spots.forEach(([x, z], i) => place(players[i], x, z));
  return { game, players };
}
const place = (p, x, z, y = 0) => {
  Object.assign(p.mover, { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true });
  Object.assign(p, { protectedUntil: 0, yaw: 0, pitch: 0 });
};
const at = { yaw: 0, pitch: 0, rt: 0 }; // an input aiming at -z
const run = (game, seconds) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) game.step(); };
const messages = (p) => p.conn.sent.map((d) => JSON.parse(d));
const events = (p, e) => messages(p).filter((m) => m.t === 'event' && m.e === e);
const lastSnap = (p) => messages(p).filter((m) => m.t === 'snapshot').at(-1);
const until = (game, done, seconds = 3) => { for (let i = 0; i < seconds * TICK_RATE && !done(); i++) game.step(); };

// One real input per tick for each driven player, through the jitter buffer.
function feed(game, p, keys, yaw) {
  const s = (p.queue.at(-1)?.s ?? p.ack) + 1;
  p.receive({ t: 'input', s, rt: game.tick, keys, yaw, pitch: 0, fire: false, shot: 0, slot: 0 }, performance.now());
}
function drive(game, plans, ticks) { // plans: [[player, (i) => [keys, yaw]]]
  for (const [p, plan] of plans) if (!p.queue.length) feed(game, p, ...plan(-1));
  for (let i = 0; i < ticks; i++) {
    for (const [p, plan] of plans) feed(game, p, ...plan(i));
    game.step();
  }
}

// ---- Pads ----

test('a pad hands its item to the first player through it, ignores a full inventory and refills slower in small games', () => {
  const { game, players: [full, p, other] } = match([[0, 0], [0.5, 0], [30, 30]], 'arena_01', arena);
  full.pw.inv = ['mine', 'mine', 'mine'];
  game.step();
  assert.deepEqual([full.pw.inv.length, p.pw.inv], [3, ['shunt']]);
  assert.deepEqual(events(other, 'pick').map((m) => [m.id, m.pad, m.k]), [[p.id, 0, 'shunt']]);
  const pad = game.powers.pads[0];
  assert.equal(pad.span, 30 * TICK_RATE * 2); // 3 players: twice the 6-player respawn
  p.pw.inv = [];
  run(game, 59.9);
  assert.deepEqual(p.pw.inv, []); // still standing on it, but it is empty
  run(game, 0.2);
  assert.deepEqual(p.pw.inv, ['shunt']);
});

test('the east lane pad rotates Barge, Bolt, Barge, showing the next item while it refills', () => {
  const { game, players: [p] } = match([[8, 0]], 'arena_01', arena);
  const got = [];
  for (let i = 0; i < 3; i++) {
    game.step();
    got.push(p.pw.inv.pop());
    assert.equal(JSON.parse(game.powers.snapshot()).pd[3][0], POWER_IDS.indexOf(i % 2 ? 'barge' : 'bolt'));
    game.powers.pads[3].readyAt = game.tick + 1;
    game.step();
  }
  assert.deepEqual(got, ['barge', 'bolt', 'barge']);
});

test('a new match puts every pad back to up at its first item and clears entities and kills', () => {
  const { game, players: [p] } = match([[8, 0]], 'arena_01', arena);
  game.step();
  game.powers.use(p, 'mine', at);
  p.pk = 2;
  game.endMatch();
  game.startMatch();
  const { pd, en } = JSON.parse(game.powers.snapshot());
  assert.deepEqual(pd[3], [POWER_IDS.indexOf('barge'), 0, 0]);
  assert.deepEqual([en, p.pk, p.pw.inv], [[], 0, []]);
});

// ---- Shunt ----

test('a Shunt locks on the enemy nearest the crosshair in sight, hits for 60 and shoves along its flight', () => {
  const { game, players: [user, target, wide] } = match([[0, 0], [5, -12], [30, -12]]); // 22.6° and 68° off
  game.powers.use(user, 'shunt', at);
  const [shunt] = game.powers.ents;
  assert.equal(shunt.target, target.id);
  until(game, () => target.hp < MAX_HP);
  assert.equal(target.hp, MAX_HP - POWERS.shunt.direct);
  assert.ok(target.mover.vz < -3 && target.mover.vy > 0, `vz ${target.mover.vz} vy ${target.mover.vy}`);
  assert.equal(wide.hp, MAX_HP);
  const [boom] = events(wide, 'boom');
  assert.deepEqual([boom.k, boom.r, boom.id], ['shunt', POWERS.shunt.splash, user.id]);
  const [hit] = events(target, 'hit');
  assert.deepEqual([hit.w, hit.dmg], ['shunt', 60]);
  assert.ok(Number.isFinite(hit.sx) && Number.isFinite(hit.sz));
});

test('a Shunt does not lock through a wall, and flies straight', () => {
  const map = { ...flat, boxes: [...flat.boxes, wall(5, -8, 4, 1)] };
  const { game, players: [user] } = match([[0, 0], [5, -12]], 'flat', map);
  game.powers.use(user, 'shunt', at);
  assert.equal(game.powers.ents[0].target, null);
  run(game, 1);
  assert.ok(Math.abs(game.powers.ents[0].x) < 1e-9);
});

test('a Shunt splash hurts everyone near but the direct victim (once) and the owner', () => {
  const { game, players: [user, target, near] } = match([[0, 0], [0, -6], [1.2, -6]]);
  game.powers.use(user, 'shunt', at);
  until(game, () => target.hp < MAX_HP);
  assert.equal(target.hp, MAX_HP - 60); // the direct hit, no splash on top
  assert.ok(near.hp < MAX_HP && near.hp > MAX_HP - POWERS.shunt.splashMax, `near ${near.hp}`);
  assert.ok(near.mover.vx > 0, 'pushed away from the blast');
  // Fired point-blank into a wall: the owner stands in the splash, unhurt.
  const map = { ...flat, boxes: [...flat.boxes, wall(0, -1.5, 4, 1)] };
  const g2 = match([[0, 0], [1.5, 0]], 'flat', map);
  g2.game.powers.use(g2.players[0], 'shunt', at);
  run(g2.game, 0.5);
  assert.equal(g2.players[0].hp, MAX_HP);
  assert.ok(g2.players[1].hp < MAX_HP);
});

test('one bullet at a Shunt\'s rewound position fizzles it with no damage; its current spot needs the current tick', () => {
  const { game, players: [user, shooter] } = match([[0, 0], [5, -3]]); // 59° off: no lock
  game.powers.use(user, 'shunt', at);
  const launched = game.tick;
  run(game, 0.5); // 30 ticks: now 9 m out
  const eye = eyeOf(shooter.mover);
  const left = [-1, 0, 0];
  game.powers.shot(shooter, eye, left, 200, game.tick); // where it was at launch + 10 is no longer there
  assert.ok(!game.powers.ents[0].gone);
  game.powers.shot(shooter, eye, left, 200, launched + 10); // what the shooter saw
  game.step();
  assert.equal(game.powers.ents.length, 0);
  const [boom] = events(user, 'boom');
  assert.deepEqual([boom.k, boom.r, boom.id], ['shunt', 0, shooter.id]);
  assert.deepEqual([user.hp, shooter.hp], [MAX_HP, MAX_HP]);
  // The owner's own bullets fly through it.
  game.powers.use(user, 'shunt', at);
  game.step();
  game.powers.shot(user, eyeOf(user.mover), [0, 0, -1], 200, game.tick);
  assert.ok(!game.powers.ents[0].gone);
});

test('a Shunt launched by a real input rewinds to where clients draw it between ticks', () => {
  const { game, players: [user, shooter] } = match([[0, 0], [5, -3]]);
  user.pw.inv = ['shunt'];
  drive(game, [[user, (i) => [i === 0 ? KEY.USE : 0, 0]]], 20);
  const [e] = game.powers.ents;
  const [a, b] = e.hist.slice(5, 7);
  assert.equal(b[0], a[0] + 1); // one entry per tick
  const drawn = [(a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2]; // half a tick on
  const from = [5, drawn[1], drawn[2]];
  game.powers.shot(shooter, from, [-1, 0, 0], 200, a[0] + 1.5); // a tick later it is 0.3 m on: a miss
  assert.equal(e.gone, undefined);
  game.powers.shot(shooter, from, [-1, 0, 0], 200, a[0] + 0.5);
  assert.equal(e.gone, true);
});

test('a Shunt shoot-down rewinds at most HISTORY_TICKS, like the guns', () => {
  const { game, players: [user, shooter] } = match([[0, 0], [5, -3]]);
  game.powers.use(user, 'shunt', at);
  const launched = game.tick;
  run(game, 1.5);
  const [e] = game.powers.ents;
  const where = (t) => e.hist.find((h) => h[0] === t);
  const ray = (h, rt) => game.powers.shot(shooter, [5, h[2], h[3]], [-1, 0, 0], 200, rt);
  ray(where(launched + 5), launched + 5); // an rt from before the window
  assert.equal(e.gone, undefined);
  ray(where(game.tick - HISTORY_TICKS), launched + 5); // read as the oldest tick it keeps
  assert.equal(e.gone, true);
});

// ---- Bolt ----

test('Bolt fires three rewound 25-damage hitscan shots 0.25 s apart and locks the gun for 0.55 s', () => {
  const { game, players: [user, target] } = match([[0, 0], [0, -10]]);
  user.pw.inv = ['bolt'];
  drive(game, [[user, (i) => [i === 0 ? KEY.USE : 0, 0]]], 2);
  assert.ok(user.arsenal.switching > 0.5);
  drive(game, [[user, () => [0, 0]]], 40);
  assert.equal(target.hp, MAX_HP - 3 * POWERS.bolt.dmg);
  const shots = events(target, 'shot').filter((m) => m.w === 'bolt');
  assert.equal(shots.length, 3);
  assert.equal(events(user, 'shot').length, 0); // the user draws their own
  assert.deepEqual(events(target, 'use').map((m) => m.k), ['bolt']);
  assert.ok(events(target, 'hit').every((h) => h.dmg === 25 && h.w === 'bolt' && !h.head));
});

// ---- Barge ----

test('Barge hurts 20 to 10 across 5 m, needs line of sight, clears enemy Shunts and Mines and keeps the user\'s own', () => {
  const map = { ...flat, boxes: [...flat.boxes, wall(-3, 0, 1, 4)] };
  const { game, players: [user, mid, hidden, foe] } = match([[0, 0], [2.8, 0], [-4, 0], [0, 20]], 'flat', map);
  game.powers.use(foe, 'mine', at);
  foe.mover.z = 2;
  game.powers.use(foe, 'mine', at);
  foe.mover.z = 20;
  game.powers.use(user, 'mine', at);
  game.powers.use(user, 'barge', at);
  game.step();
  assert.equal(mid.hp, MAX_HP - 15); // 2.5 m from the chest to its box
  assert.equal(hidden.hp, MAX_HP);
  assert.ok(mid.mover.vx > 0 && mid.mover.vy > 0);
  assert.deepEqual(game.powers.ents.map((e) => e.by.id), [foe.id, user.id]); // the foe's far mine and the user's own stay
  assert.equal(events(user, 'boom').filter((b) => b.r === 0).length, 1);
});

test('Barge at point-blank throws a victim about 5.8 m with the real movement step', () => {
  const { game, players: [user, victim] } = match([[0, 0], [0.01, 0]]);
  game.powers.use(user, 'barge', at);
  game.step();
  assert.equal(victim.hp, MAX_HP - 20);
  run(game, 2);
  assert.ok(Math.abs(victim.mover.x - 5.8) < 0.15, `thrown ${victim.mover.x} m`);
  assert.ok(victim.mover.grounded);
});

// ---- Shock ----

test('Shock targets the leader, or the runner-up when the user leads, and strikes each player once per cast', () => {
  const { game, players: [user, second, third] } = match([[0, 0], [10, 0], [-10, 0]]);
  Object.assign(user, { kills: 5 });
  Object.assign(second, { kills: 3 });
  Object.assign(third, { kills: 1 });
  game.powers.use(user, 'shock', at);
  const domes = game.powers.ents.filter((e) => e.type === ENT.DOME);
  assert.deepEqual(domes.map((d) => [d.x, d.z, d.target, d.strikeAt - game.tick]), [[10, 0, second.id, 72], [10, 0, second.id, 96], [10, 0, second.id, 120]]);
  run(game, 2.1);
  assert.equal(second.hp, MAX_HP - POWERS.shock.dmg); // three domes, one hit
  assert.equal(third.hp, MAX_HP);
  assert.ok(second.mover.slow > 0);
  assert.ok(lastSnap(user).ps.find(([id]) => id === second.id)[6] & PLAYER_FLAGS.SLOWED);
  assert.deepEqual(events(user, 'boom').filter((b) => b.k === 'shock').length, 3);
});

test('Shock catches a straight runner but not one who turns at 0.3 s; a Shield blocks it', () => {
  for (const turn of [false, true]) {
    const { game, players: [user, runner] } = match([[0, 15], [0, 10]]);
    runner.kills = 1;
    drive(game, [[runner, () => [KEY.FORWARD, 0]]], 30); // up to speed, heading -z
    game.powers.use(user, 'shock', at);
    drive(game, [[runner, (i) => [KEY.FORWARD, turn && i >= 18 ? Math.PI / 2 : 0]]], 130);
    assert.equal(runner.hp, turn ? MAX_HP : MAX_HP - 30, turn ? 'turned' : 'straight');
  }
  const { game, players: [user, still] } = match([[0, 0], [10, 0]]);
  still.pw.shield = 60;
  still.pw.shieldT = 600;
  game.powers.use(user, 'shock', at);
  run(game, 2.1);
  assert.deepEqual([still.hp, still.pw.shield, still.mover.slow], [MAX_HP, 30, 0]);
});

// ---- Mine ----

test('a Mine arms after 48 ticks, fuses for 15, spares its owner and keeps two per owner', () => {
  const { game, players: [owner, enemy] } = match([[0, 0], [10, 0]]);
  owner.mover.y = 2; // dropped from mid-air: it lands on the floor below
  game.powers.use(owner, 'mine', at);
  const dropped = game.tick;
  const [mine] = game.powers.ents;
  assert.equal(mine.y, 0);
  owner.mover.y = 0;
  const state = () => JSON.parse(game.powers.snapshot()).en[0][6];
  enemy.mover.x = 0.5; // standing on it before it arms is safe
  while (game.tick < dropped + 47) game.step();
  assert.equal(state(), 0);
  game.step(); // tick 48: armed, and the enemy on it lights the fuse
  assert.equal(state(), 2);
  for (let i = 0; i < 14; i++) game.step();
  assert.equal(enemy.hp, MAX_HP);
  game.step();
  assert.equal(enemy.hp, MAX_HP - 56); // its box 0.2 m from the blast: 60 -> 15 over 2.5 m
  assert.equal(owner.hp, MAX_HP); // in the blast, but it is the owner's
  assert.ok(enemy.mover.vy > 0);
  for (let i = 0; i < 3; i++) game.powers.use(owner, 'mine', at);
  assert.equal(game.powers.ents.filter((e) => !e.gone).length, 2);
});

test('a shot Mine goes off for the shooter, owner included', () => {
  const { game, players: [owner, victim, shooter] } = match([[0, 0], [1, 0], [0, 10]]);
  victim.hp = 20;
  game.powers.use(owner, 'mine', at);
  owner.mover.x = -1;
  const eye = eyeOf(shooter.mover);
  const aim = [0 - eye[0], 0.15 - eye[1], 0 - eye[2]];
  const len = Math.hypot(...aim);
  game.powers.shot(shooter, eye, aim.map((v) => v / len), 200, game.tick);
  game.step();
  assert.equal(victim.alive, false);
  assert.ok(owner.hp < MAX_HP);
  const [kill] = events(owner, 'kill');
  assert.deepEqual([kill.k, kill.w], [shooter.id, 'mine']);
  assert.equal(shooter.pk, 1);
});

// ---- Shield, protection, wire ----

test('a Shield absorbs 60: two rifle body hits break it, and a 160 headshot kills through it', () => {
  const { game, players: [a, b] } = match([[0, 0], [5, 0]]);
  b.pw.shield = 60;
  game.damage(a, b, 30, false, 'rifle');
  assert.deepEqual([b.hp, b.pw.shield], [MAX_HP, 30]);
  game.damage(a, b, 30, false, 'rifle');
  assert.deepEqual([b.hp, b.pw.shield], [MAX_HP, 0]);
  const hit = events(a, 'hit').at(-1);
  assert.deepEqual([hit.dmg, hit.sh], [0, 30]);
  game.damage(a, b, 30, false, 'rifle');
  assert.deepEqual([b.hp, b.pw.shield], [MAX_HP - 30, 0]);
  const { players: [c, d], game: g2 } = match([[0, 0], [5, 0]]);
  d.pw.shield = 60;
  g2.damage(c, d, 160, true, 'rifle');
  assert.equal(d.alive, false);
});

test('spawn protection blocks power-up damage, knock and slow', () => {
  const { game, players: [user, fresh] } = match([[0, 0], [1.5, 0]]);
  fresh.protectedUntil = game.tick + 600;
  game.powers.use(user, 'barge', at);
  game.powers.use(user, 'mine', at);
  game.step();
  assert.deepEqual([fresh.hp, fresh.mover.vx, fresh.mover.vy], [MAX_HP, 0, 0]);
  user.kills = 0;
  fresh.kills = 1;
  game.powers.use(user, 'shock', at);
  run(game, 2.1);
  assert.deepEqual([fresh.hp, fresh.mover.slow], [MAX_HP, 0]);
});

test('the pu state stays under 600 B with 9 pads and 6 entities, and the snapshot carries pw and the flags', () => {
  const { game, players: [p, q] } = match([[-15, -15], [15, 15]], 'arena_01', arena);
  game.powers.use(p, 'shunt', at);
  game.powers.use(q, 'shunt', at);
  game.powers.use(p, 'mine', at);
  game.powers.use(q, 'mine', at);
  game.powers.use(p, 'shock', at); // three domes
  q.pw.shield = 60;
  q.mover.boost = 100;
  game.step();
  const pu = game.powers.snapshot();
  const { pd, en } = JSON.parse(pu);
  assert.equal(pd.length, arena.pads.length);
  assert.ok(en.length >= 6, `${en.length} entities`);
  assert.ok(pu.length < 600, `${pu.length} B`);
  const snap = lastSnap(p);
  assert.deepEqual(Object.keys(snap.me.pw).sort(), ['bolts', 'boltT', 'cd', 'inv', 'sel', 'shield', 'shieldT'].sort());
  const flags = snap.ps.find(([id]) => id === q.id)[6];
  assert.ok(flags & PLAYER_FLAGS.BUBBLE && flags & PLAYER_FLAGS.NITRO);
});

// The real client prediction (client/net.js) against the real server, over
// the JSON snapshot: every predicted step must equal the server's, Nitro and
// the cooldown included, except the few in flight when a knock the client
// could not foresee lands; after that one reconcile, prediction is exact.
test('client prediction matches the server step for step through Nitro, and re-converges after a knock', async () => {
  const { self, predict, reconcile } = await import('../client/net.js');
  const { knock } = await import('../shared/movement.js');
  const { game, players: [p] } = match([[0, 0]]);
  p.pw.inv = ['nitro', 'mine'];
  Object.assign(self, { mover: structuredClone(p.mover), arsenal: structuredClone(p.arsenal), hp: p.hp, alive: true, pw: structuredClone(p.pw), pending: [], seq: 0, shots: 0 });
  const predicted = new Map(); // seq → the mover the client predicted after it, as JSON
  const wrong = [];
  const used = [];
  for (let i = 1; i <= 300; i++) { // Nitro from input 5, a knock at 120
    const input = { keys: KEY.FORWARD | (i === 5 || i === 30 ? KEY.USE : 0) | (i % 40 === 0 ? KEY.JUMP : 0), yaw: 0.01 * i, pitch: 0, fire: false, slot: 0, rt: 0 };
    predict(input, game.map.boxes);
    if (input.power) used.push([i, input.power]);
    predicted.set(input.s, JSON.stringify([self.mover, self.pw]));
    p.receive({ t: 'input', ...input }, performance.now());
    if (i === 120) knock(p.mover, 6, 0, 5);
    game.step();
    const snap = lastSnap(p);
    if (snap.ack && JSON.stringify([snap.me.mover, snap.me.pw]) !== predicted.get(snap.ack)) wrong.push(snap.ack);
    reconcile(snap, game.map.boxes);
  }
  assert.deepEqual(used, [[5, 'nitro']]); // input 30 fell in the cooldown
  assert.ok(p.mover.boost === 0 && p.pw.inv.length === 1, 'Nitro was used and has run out');
  assert.ok(wrong.length > 0 && wrong.length <= 2 && wrong.every((s) => s >= 118 && s <= 121), `mispredicted: ${wrong}`);
  assert.deepEqual(self.pw, p.pw);
});
