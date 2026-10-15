// Map voting and switching (ticket 20), through a real Game with fake sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, pickMap } from './game.js';
import { SCOREBOARD_SECONDS, TICK_RATE } from '../shared/constants.js';

const floor = { pos: [0, -0.5, 0], size: [80, 1, 80] };
const MAP_A = { name: 'Alpha', tagline: 'one', boxes: [floor], spawns: [[0, 0, 0], [5, 0, 0]], pads: [{ pos: [1, 0, 1], pool: ['mine'], respawn: 20 }] };
const MAP_B = {
  name: 'Bravo', tagline: 'two', boxes: [floor], spawns: [[10, 0, 10], [12, 0, 10], [14, 0, 10]],
  pads: [{ pos: [-3, 0, -3], pool: ['nitro'], respawn: 20 }, { pos: [3, 0, -3], pool: ['bolt'], respawn: 20 }],
};
const newGame = () => new Game('a', MAP_A, new Map([['a', MAP_A], ['b', MAP_B]]));

const conn = (loopback = false) => {
  const c = { loopback, rtt: 0, lastPong: Date.now(), player: null, out: [] };
  c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)), terminate() {} };
  return c;
};
const join = (game, name, { bot = false, loopback = false } = {}) => {
  const c = conn(loopback);
  game.handle(c, { t: 'join', name, bot });
  return c;
};
const lobby = (c) => c.out.filter((m) => m.t === 'lobby').at(-1);
const tally = (c) => Object.fromEntries(lobby(c).maps.map((m) => [m.id, m.voters]));
const vote = (game, c, map) => game.handle(c, { t: 'vote', map });

test('the winner: most votes, then the host\'s pick, then list order; no votes keeps the current map', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(pickMap([], null, order, 'b'), 'b');
  assert.equal(pickMap(['c'], null, order, 'a'), 'c');
  assert.equal(pickMap(['b', 'c', 'c'], 'b', order, 'a'), 'c', 'most votes beat the host');
  assert.equal(pickMap(['b', 'c'], 'c', order, 'a'), 'c', 'a tie goes to the host\'s pick');
  assert.equal(pickMap(['c', 'b'], undefined, order, 'a'), 'b', 'host did not vote: the earliest tied map');
  assert.equal(pickMap(['c', 'b', 'c', 'b', 'a'], 'a', order, 'c'), 'b', 'the host\'s pick is not tied: the earliest tied map');
});

test('votes: bots never count, a vote can change, leaving drops it, and a match start clears them', () => {
  const game = newGame();
  const alice = join(game, 'Alice', { loopback: true });
  const bob = join(game, 'Bob');
  const bot = join(game, 'bot1', { bot: true });
  vote(game, bot, 'b');
  assert.deepEqual(tally(alice), { a: [], b: [] }, 'a bot\'s vote is ignored');
  vote(game, alice, 'zzz');
  assert.deepEqual(tally(alice), { a: [], b: [] }, 'an unloaded map is ignored');
  game.handle(alice, { t: 'start' });
  assert.equal(game.mapId, 'a', 'only the bot voted: the map stays');

  game.handle(alice, { t: 'end_match' });
  vote(game, bob, 'b');
  assert.deepEqual(tally(alice), { a: [], b: [bob.player.id] });
  assert.equal(lobby(alice).maps[1].votes, 1);
  vote(game, bob, 'a');
  assert.deepEqual(tally(alice), { a: [bob.player.id], b: [] }, 'changed, not added');
  vote(game, alice, 'b');
  const carol = join(game, 'Carol');
  vote(game, carol, 'a');
  game.disconnect(carol);
  assert.deepEqual(tally(alice), { a: [bob.player.id], b: [alice.player.id] }, 'Carol left and her vote went with her');
  for (let i = 0; i <= SCOREBOARD_SECONDS * TICK_RATE; i++) game.step();
  assert.equal(game.phase, 'playing');
  assert.equal(game.mapId, 'b', '1 to 1: the host\'s pick');
  assert.equal(lobby(alice).map, 'b');
  assert.deepEqual(tally(alice), { a: [], b: [] }, 'votes clear when the match starts');
  assert.ok([...game.players.values()].every((p) => p.vote === null));
});

test('a switch brings fresh spawns, pads, no entities and an empty rewind history; joiners land on the new map', () => {
  const game = newGame();
  const alice = join(game, 'Alice', { loopback: true });
  const bob = join(game, 'Bob');
  game.handle(alice, { t: 'start' });
  game.step();
  game.powers.drop(alice.player); // a Mine left lying on map a
  assert.equal(game.powers.ents.length, 1);
  assert.equal(game.history.newest, game.tick, 'the rewind history has a frame on map a');

  vote(game, bob, 'b');
  assert.equal(game.players.get(bob.player.id).vote ?? null, null, 'no voting mid-match');
  game.handle(alice, { t: 'end_match' });
  vote(game, bob, 'b'); // on the scoreboard
  for (let i = 0; i <= SCOREBOARD_SECONDS * TICK_RATE && game.phase !== 'playing'; i++) game.step();
  assert.equal(game.mapId, 'b');
  assert.equal(game.spawnUsedAt.length, MAP_B.spawns.length);
  for (const p of game.players.values()) {
    assert.ok(MAP_B.spawns.some(([x, , z]) => x === p.mover.x && z === p.mover.z), `${p.name} spawned on map b`);
  }
  assert.deepEqual(game.powers.pads.map((p) => [p.pos, p.readyAt]), MAP_B.pads.map((p) => [p.pos, 0]));
  assert.equal(game.powers.ents.length, 0, 'the Mine did not follow');
  assert.equal(game.history.newest, -Infinity, 'nothing to rewind into map a');
  assert.deepEqual(game.history.at(game.tick - 5, game.tick), []);

  const late = join(game, 'Dan');
  assert.equal(late.out.find((m) => m.t === 'welcome').map, 'b', 'a late joiner');
  game.disconnect(bob);
  const back = join(game, 'bob');
  assert.equal(back.player.name, 'Bob');
  assert.equal(back.out.find((m) => m.t === 'welcome').map, 'b', 'a rejoin by name');
});
