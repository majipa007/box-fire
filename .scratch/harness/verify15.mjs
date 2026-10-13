// Ticket 15 check, in-process: phases, win conditions, end match, joins
// during the scoreboard, spawn protection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '/home/sukuna/personal_projects/game/server/game.js';

const map = JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'));
const conn = (loopback) => {
  const c = { loopback, rtt: 0, player: null, out: [] };
  c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)) };
  return c;
};
const events = (c, e) => c.out.filter((m) => m.t === 'event' && m.e === e);
const lastLobby = (c) => c.out.filter((m) => m.t === 'lobby').at(-1);
const ticks = (game, n) => { for (let i = 0; i < n; i++) game.step(); };

function setup() {
  const game = new Game('arena_01', map);
  const [ca, cb] = [conn(true), conn(false)];
  game.handle(ca, { t: 'join', name: 'Alice', bot: false });
  game.handle(cb, { t: 'join', name: 'Bob', bot: false });
  game.handle(ca, { t: 'start' });
  return { game, ca, cb, A: ca.player, B: cb.player };
}

// 30 kills ends the match; 15 s later a fresh one starts.
{
  const { game, ca, cb, A, B } = setup();
  assert.equal(lastLobby(cb).phase, 'playing');
  assert.equal(lastLobby(cb).end - lastLobby(cb).tick, 8 * 60 * 60);
  ticks(game, 130); // past spawn protection
  for (let k = 0; k < 30; k++) {
    B.alive = true;
    B.protectedUntil = 0;
    B.hp = 1;
    game.damage(A, B, 50, false, 'rifle');
  }
  ticks(game, 1);
  assert.equal(game.phase, 'scoreboard');
  assert.equal(events(cb, 'match_end').at(-1).winner, A.id);
  ticks(game, 15 * 60 - 1);
  assert.equal(game.phase, 'scoreboard', 'still on the scoreboard just before 15 s');
  ticks(game, 1);
  assert.equal(game.phase, 'playing');
  assert.deepEqual([A.kills, A.deaths, B.kills, B.deaths], [0, 0, 0, 0], 'scores reset');
  assert.ok(A.alive && B.alive, 'everyone spawned');
  console.log('kill target, scoreboard and restart ok');
}

// The 8-minute clock ends a quiet match.
{
  const { game } = setup();
  ticks(game, 8 * 60 * 60 - 1);
  assert.equal(game.phase, 'playing');
  ticks(game, 1);
  assert.equal(game.phase, 'scoreboard');
  console.log('8 minute clock ok');
}

// Only the host can end the match early.
{
  const { game, ca, cb } = setup();
  game.handle(cb, { t: 'end_match' });
  assert.equal(game.phase, 'playing', 'not the host: ignored');
  game.handle(ca, { t: 'end_match' });
  assert.equal(game.phase, 'scoreboard');
  // Someone joining during the scoreboard waits for the next match.
  const cc = conn(false);
  game.handle(cc, { t: 'join', name: 'Cara', bot: false });
  const C = cc.player;
  assert.equal(C.alive, false);
  assert.equal(events(cc, 'spawn').filter((e) => e.id === C.id).length, 0);
  ticks(game, 15 * 60);
  assert.equal(game.phase, 'playing');
  assert.equal(C.alive, true, 'spawned with the next match');
  console.log('host end match and scoreboard joins ok');
}

// Spawn protection: 2 s of no damage, ended early by firing.
{
  const { game, A, B, ca } = setup();
  ticks(game, 1);
  game.damage(A, B, 40, false, 'rifle');
  assert.equal(B.hp, 100, 'protected right after spawning');
  ticks(game, 120);
  game.damage(A, B, 40, false, 'rifle');
  assert.equal(B.hp, 60, 'protection over after 2 s');

  const fresh = setup();
  ticks(fresh.game, 1);
  let s = 0;
  const shoot = () => fresh.B.receive({ t: 'input', s: ++s, rt: fresh.game.tick, keys: 0, yaw: 0, pitch: 0, fire: true, shot: s, slot: 0 }, performance.now());
  shoot(); shoot();
  ticks(fresh.game, 2);
  assert.equal(fresh.B.protectedUntil, 0, 'firing ends protection');
  fresh.game.damage(fresh.A, fresh.B, 40, false, 'rifle');
  assert.equal(fresh.B.hp, 60);
  console.log('spawn protection ok');
}
