// What a bot decides to do, from what it can see: messages in, goal and
// input out. Situations are built from the same messages the server sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMover } from '../../shared/movement.js';
import { createArsenal } from '../../shared/weapons.js';
import { createPowers, clearLine } from '../../shared/powerups.js';
import { PLAYER_FLAGS } from '../../shared/protocol.js';
import { shotRng } from '../../shared/rng.js';
import { navFor } from './nav.js';
import { createBot, onMessage, think } from './brain.js';

const ALIVE = PLAYER_FLAGS.ALIVE;
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const boxes = navFor('arena_01').map.boxes;

// A bot (id 1) on arena_01 at `at`, looking along `yaw`, in a snapshot with
// the foes given as [id, x, y, z, flags, hp].
function situation({ at, yaw, hp = 100, foes = [], skill = 'normal', passive = false, tick = 1000, primary = 'rifle', inv = [] }) {
  const bot = createBot(1, { skill, passive, primary, rand: shotRng(3, 0, 0) });
  onMessage(bot, { t: 'welcome', id: 1, map: 'arena_01' });
  onMessage(bot, { t: 'event', e: 'spawn', id: 1, x: at[0], y: at[1], z: at[2], yaw, primary });
  const snap = (t) => ({
    t: 'snapshot', tick: t, ack: 0,
    me: { mover: { ...createMover(...at), grounded: true }, arsenal: createArsenal(primary), hp, alive: true, pw: { ...createPowers(), inv } },
    ps: [[1, ...at, yaw, 0, ALIVE, hp, 0], ...foes.map(([id, x, y, z, flags, fhp = 100]) => [id, x, y, z, 0, 0, flags, fhp, 0])],
    pu: { pd: navFor('arena_01').map.pads.map(() => [0, 0, 0]), en: [] },
  });
  onMessage(bot, snap(tick));
  return { bot, snap };
}

const budget = () => ({ plans: 3 });

test('a bot fights a foe it can see, and never one behind a wall or behind its back', () => {
  // In the open, 7 m ahead.
  const ahead = situation({ at: [-17, 0, -17], yaw: yawTo(1, 1), foes: [[2, -12, 0, -12, ALIVE]] });
  assert.ok(clearLine([-17, 1.6, -17], [-12, 1, -12], boxes), 'fixture: the line is clear');
  think(ahead.bot, budget());
  assert.equal(ahead.bot.goal.kind, 'fight');

  // 6 m ahead, but behind the wall at x = -8.
  const walled = situation({ at: [-11, 0, -9], yaw: yawTo(1, 0), foes: [[2, -5, 0, -9, ALIVE]] });
  assert.ok(!clearLine([-11, 1.6, -9], [-5, 1, -9], boxes) && !clearLine([-11, 1.6, -9], [-5, 1.65, -9], boxes), 'fixture: the wall hides it');
  think(walled.bot, budget());
  assert.notEqual(walled.bot.goal.kind, 'fight');

  // In the open, 6 m behind it: past the 5 m a normal bot notices behind it.
  const behind = situation({ at: [-11, 0, -9], yaw: yawTo(1, 0), foes: [[2, -17, 0, -9, ALIVE]] });
  assert.ok(clearLine([-11, 1.6, -9], [-17, 1, -9], boxes), 'fixture: the line is clear');
  think(behind.bot, budget());
  assert.notEqual(behind.bot.goal.kind, 'fight');
});

test('a hurt bot takes cover from a foe it can see, at a spot that foe cannot see', () => {
  // Beside the end of the wall at x = -8, a foe 10 m off in the open.
  const foe = [-2, 0, -12];
  assert.ok(clearLine([-7, 1.6, -3], [-2, 1, -12], boxes), 'fixture: the line is clear');
  const { bot } = situation({ at: [-7, 0, -3], yaw: yawTo(5, -9), hp: 30, foes: [[2, ...foe, ALIVE]] });
  think(bot, budget());
  assert.equal(bot.goal.kind, 'cover');
  const [x, y, z] = bot.goal.pos;
  assert.ok(!clearLine([foe[0], foe[1] + 1.6, foe[2]], [x, y + 1, z], boxes), `the foe can see ${x.toFixed(1)}, ${z.toFixed(1)}`);
});

test('a bot leaves a pad that just came up for 2-8 s, unless it is within 6 m; passive bots collect pads too', () => {
  for (const passive of [false, true]) {
    // 9 m from the nearest pad, at (-16, 0, -8).
    const far = situation({ at: [-17, 0, -17], yaw: yawTo(1, 1), passive, tick: 1000 });
    think(far.bot, budget());
    assert.notEqual(far.bot.goal.kind, 'pad', 'patience: not straight away');
    onMessage(far.bot, far.snap(1000 + 2 * 60 - 13));
    think(far.bot, budget());
    assert.notEqual(far.bot.goal.kind, 'pad', 'patience: not before 2 s');
    onMessage(far.bot, far.snap(1000 + 8 * 60 + 1));
    think(far.bot, budget());
    assert.equal(far.bot.goal.kind, 'pad', 'patience passed');
    assert.deepEqual(far.bot.goal.pos, [-16, 0, -8]);
  }
  const near = situation({ at: [-16, 0, -12], yaw: 0, tick: 1000 });
  think(near.bot, budget());
  assert.equal(near.bot.goal.kind, 'pad');
});

test('a bot shoots a foe it can see, but never a spawn-protected one, and a passive bot never shoots', () => {
  const shotsIn2s = (flags, passive = false) => {
    const { bot, snap } = situation({ at: [-17, 0, -17], yaw: yawTo(1, 1), foes: [[2, -12, 0, -12, flags]], passive });
    let shots = 0;
    for (let t = 1000; t < 1120; t++) { onMessage(bot, snap(t)); shots += think(bot, budget()).fire ? 1 : 0; }
    return shots;
  };
  assert.ok(shotsIn2s(ALIVE) > 0, 'shoots a bare foe');
  assert.equal(shotsIn2s(ALIVE | PLAYER_FLAGS.SHIELDED), 0, 'spawn protection');
  assert.equal(shotsIn2s(ALIVE, true), 0, 'passive');
});

test('a shotgun bot fights a far foe with its pistol and a near one with the shotgun', () => {
  const slotFor = (foe) => {
    assert.ok(clearLine([10, 1.6, -17], [foe[0], 1, foe[2]], boxes), 'fixture: the line is clear');
    const { bot } = situation({ at: [10, 0, -17], yaw: yawTo(0, 1), primary: 'shotgun', foes: [[2, ...foe, ALIVE]] });
    return think(bot, budget()).slot;
  };
  assert.equal(slotFor([10, 0, 3]), 1, '20 m: pistol');
  assert.equal(slotFor([10, 0, -12]), 0, '5 m: shotgun');
});

test('a bot follows a map switch, which spawns it before the lobby names the map, and ignores unlisted maps', () => {
  const { bot } = situation({ at: [-17, 0, -17], yaw: yawTo(1, 1) });
  think(bot, budget());
  const a2 = navFor('arena_02').map, at = a2.spawns[0];
  const onA2 = (pos) => [...a2.spawns, ...a2.pads.map((p) => p.pos)].some((q) => q.every((v, i) => v === pos[i]));
  const snap = (t) => ({
    t: 'snapshot', tick: t, ack: 0,
    me: { mover: { ...createMover(...at), grounded: true }, arsenal: createArsenal('rifle'), hp: 100, alive: true, pw: createPowers() },
    ps: [[1, ...at, 0, 0, ALIVE, 100, 0]], pu: { pd: a2.pads.map(() => [0, 0, 0]), en: [] },
  });
  onMessage(bot, { t: 'event', e: 'spawn', id: 1, x: at[0], y: at[1], z: at[2], yaw: 0, primary: 'rifle' });
  onMessage(bot, { t: 'lobby', phase: 'playing', map: 'arena_02', players: [] });
  onMessage(bot, snap(2000));
  const input = think(bot, budget());
  assert.ok(input.keys & 15, 'still spawned: it moves');
  assert.ok(onA2(bot.goal.pos), `goal ${bot.goal.pos} is on arena_02`);
  onMessage(bot, { t: 'lobby', phase: 'playing', map: 'arena_99', players: [] });
  let moving = 0;
  for (let t = 2001; t < 2200; t++) {
    onMessage(bot, snap(t));
    moving += think(bot, budget()).keys & 15 ? 1 : 0;
    if (bot.goal) assert.ok(onA2(bot.goal.pos), `goal ${bot.goal.pos} is on arena_02`);
  }
  assert.ok(moving > 150, 'still playing arena_02');
});

test('a roaming bot that holds an item still goes for a pad once patience has passed', () => {
  const { bot, snap } = situation({ at: [-17, 0, -17], yaw: yawTo(1, 1), inv: ['bolt'] });
  think(bot, budget());
  assert.equal(bot.goal.kind, 'roam');
  onMessage(bot, snap(1000 + 8 * 60 + 1));
  think(bot, budget());
  assert.equal(bot.goal.kind, 'pad');
});
