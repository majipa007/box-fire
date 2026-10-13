// Ticket 16 check, in-process: rejoin by name keeps the score, live names
// are protected, silent ones can be taken over, greyed players linger until
// the match ends, an empty server resets, a full one frees a greyed slot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '/home/sukuna/personal_projects/game/server/game.js';

const map = JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'));
const conn = (loopback = false) => {
  const c = { loopback, rtt: 0, lastPong: Date.now(), player: null, out: [], terminated: false };
  c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)), terminate: () => { c.terminated = true; } };
  return c;
};
const lastLobby = (c) => c.out.filter((m) => m.t === 'lobby').at(-1);
const ticks = (game, n) => { for (let i = 0; i < n; i++) game.step(); };

const game = new Game('arena_01', map);
const ca = conn(true);
const cb = conn();
game.handle(ca, { t: 'join', name: 'Alice', bot: false });
game.handle(cb, { t: 'join', name: 'Bob', bot: false });
game.handle(ca, { t: 'start' });
const B = cb.player;
B.kills = 3;

// Bob's tab dies: greyed out, score kept, out of the world.
game.disconnect(cb);
const row = lastLobby(ca).players.find((p) => p.id === B.id);
assert.deepEqual([row.connected, row.kills], [false, 3]);
assert.equal(B.alive, false);
ticks(game, 1);
const snap = ca.out.filter((m) => m.t === 'snapshot').at(-1);
assert.ok(!snap.ps.some((p) => p[0] === B.id && p[6] & 2), 'not alive in the world (hidden, untargetable)');
console.log('disconnect greys out and keeps the score ok');

// He reopens the URL as "bob": same player, kills back, spawned.
const cb2 = conn();
game.handle(cb2, { t: 'join', name: 'bob', bot: false });
assert.equal(cb2.player, B);
assert.equal(cb2.out.find((m) => m.t === 'welcome').id, B.id);
assert.equal(B.kills, 3);
assert.equal(B.alive, false, 'waits out the respawn timer from when he left');
ticks(game, 3 * 60 + 1);
assert.equal(B.alive, true);
assert.ok(lastLobby(ca).players.find((p) => p.id === B.id).connected);
console.log('rejoin by name ok');

// A live name is protected; a silent one (no pong for over 2 s) is not.
const thief = conn();
game.handle(thief, { t: 'join', name: 'ALICE', bot: false });
assert.equal(thief.out.find((m) => m.t === 'reject')?.reason, 'name-taken');
ca.lastPong = Date.now() - 2500;
const back = conn(true);
game.handle(back, { t: 'join', name: 'ALICE', bot: false });
assert.equal(back.player?.name, 'Alice');
assert.equal(ca.terminated, true, 'the silent socket is closed');
game.disconnect(ca); // its close event arrives later: must not detach the new socket
assert.equal(back.player.conn, back);
// The new tab must get its player back into the world (a spawn event).
ticks(game, 3 * 60 + 2);
assert.ok(back.out.some((m) => m.t === 'event' && m.e === 'spawn' && m.id === back.player.id), 'the taken-over player spawns for the new tab');
assert.equal(back.player.alive, true);
console.log('silent takeover ok');

// Greyed players go when the next match starts.
game.disconnect(cb2);
game.handle(back, { t: 'end_match' });
ticks(game, 15 * 60);
assert.equal(game.phase, 'playing');
assert.ok(![...game.players.values()].some((p) => p.id === B.id), 'Bob removed at the new match');
console.log('greyed players cleared at match end ok');

// Nobody connected for 30 s: back to the lobby, scores cleared.
game.disconnect(back);
ticks(game, 30 * 60); // the first of these ticks notices nobody is left
assert.equal(game.phase, 'playing');
ticks(game, 1);
assert.equal(game.phase, 'lobby');
assert.equal(game.players.size, 0);
console.log('empty server resets to the lobby ok');

// A full server frees a greyed slot for a newcomer.
const g2 = new Game('arena_01', map);
const conns = Array.from({ length: 10 }, (_, i) => conn(i === 0));
conns.forEach((c, i) => g2.handle(c, { t: 'join', name: `p${i}`, bot: false }));
g2.handle(conns[0], { t: 'start' });
const extra = conn();
g2.handle(extra, { t: 'join', name: 'late', bot: false });
assert.equal(extra.out.find((m) => m.t === 'reject')?.reason, 'full');
g2.disconnect(conns[5]);
const extra2 = conn();
g2.handle(extra2, { t: 'join', name: 'late', bot: false });
assert.equal(extra2.out.find((m) => m.t === 'reject')?.reason, 'full', 'greyed players keep their slot until the match ends');
console.log('full server keeps greyed slots ok');
