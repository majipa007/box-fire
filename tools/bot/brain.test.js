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
function situation({ at, yaw, hp = 100, foes = [], skill = 'normal', passive = false, tick = 1000 }) {
  const bot = createBot(1, { skill, passive, primary: 'rifle', rand: shotRng(3, 0, 0) });
  onMessage(bot, { t: 'welcome', id: 1, map: 'arena_01' });
  onMessage(bot, { t: 'event', e: 'spawn', id: 1, x: at[0], y: at[1], z: at[2], yaw, primary: 'rifle' });
  const snap = (t) => ({
    t: 'snapshot', tick: t, ack: 0,
    me: { mover: { ...createMover(...at), grounded: true }, arsenal: createArsenal('rifle'), hp, alive: true, pw: createPowers() },
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
