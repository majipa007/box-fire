// Review fixes, in-process: no phantom pistol switch after respawning,
// a page refresh doesn't heal, a full game doesn't evict greyed players.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '/home/sukuna/personal_projects/game/server/game.js';

const map = JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'));
const conn = (loopback = false) => {
  const c = { loopback, rtt: 0, lastPong: Date.now(), player: null, out: [] };
  c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)), terminate() {} };
  return c;
};
const ticks = (game, n) => { for (let i = 0; i < n; i++) game.step(); };

// 1. Die holding the pistol: the new life starts on the primary, no switch.
{
  const game = new Game('arena_01', map);
  const [ca, cb] = [conn(true), conn()];
  game.handle(ca, { t: 'join', name: 'Alice', bot: false });
  game.handle(cb, { t: 'join', name: 'Bob', bot: false });
  game.handle(ca, { t: 'start' });
  const B = cb.player;
  let s = 0;
  for (let i = 0; i < 40; i++) {
    B.receive({ t: 'input', s: ++s, rt: game.tick, keys: 0, yaw: 0, pitch: 0, fire: false, shot: 0, slot: 1 }, performance.now());
    game.step();
  }
  assert.equal(B.arsenal.slot, 1, 'holding the pistol');
  B.protectedUntil = 0;
  game.damage(ca.player, B, 200, false, 'rifle');
  // Bob's client stops sending while dead; the server goes neutral.
  ticks(game, 3 * 60 + 5);
  assert.equal(B.alive, true, 'respawned');
  assert.equal(B.arsenal.slot, 0, 'new life on the primary');
  assert.equal(B.arsenal.switching, 0, 'no phantom switch');
  console.log('respawn starts on the primary with no switch ok');
}

// 2. Refreshing mid-life: no instant heal, the respawn timer applies, no death counted.
{
  const game = new Game('arena_01', map);
  const [ca, cb] = [conn(true), conn()];
  game.handle(ca, { t: 'join', name: 'Alice', bot: false });
  game.handle(cb, { t: 'join', name: 'Bob', bot: false });
  game.handle(ca, { t: 'start' });
  const B = cb.player;
  ticks(game, 130);
  B.hp = 20;
  game.disconnect(cb);
  const cb2 = conn();
  game.handle(cb2, { t: 'join', name: 'Bob', bot: false });
  assert.equal(cb2.player, B);
  assert.equal(B.alive, false, 'not instantly back');
  assert.equal(B.deaths, 0, 'leaving is not a death on the scoreboard');
  ticks(game, 3 * 60 - 2);
  assert.equal(B.alive, false);
  ticks(game, 3);
  assert.equal(B.alive, true, 'respawned when the timer ran out');
  assert.equal(B.hp, 100);
  console.log('refresh waits out the respawn timer ok');
}

// 3. A full game keeps its greyed-out players.
{
  const game = new Game('arena_01', map);
  const conns = Array.from({ length: 10 }, (_, i) => conn(i === 0));
  conns.forEach((c, i) => game.handle(c, { t: 'join', name: `p${i}`, bot: false }));
  game.handle(conns[0], { t: 'start' });
  game.disconnect(conns[5]);
  const late = conn();
  game.handle(late, { t: 'join', name: 'late', bot: false });
  assert.equal(late.out.find((m) => m.t === 'reject')?.reason, 'full');
  assert.ok([...game.players.values()].some((p) => p.name === 'p5'), 'greyed player kept');
  console.log('full game keeps greyed players ok');
}
