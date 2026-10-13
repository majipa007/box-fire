// Ticket 08 check, in-process: placed players, scripted shots, events out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '/home/sukuna/personal_projects/game/server/game.js';

const map = JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'));
const game = new Game('arena_01', map);
const conn = (loopback) => {
  const c = { loopback, rtt: 0, player: null, out: [] };
  c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)) };
  return c;
};
const [ca, cb] = [conn(true), conn(false)];
game.handle(ca, { t: 'join', name: 'Alice', bot: false });
game.handle(cb, { t: 'join', name: 'Bob', bot: false });
game.handle(ca, { t: 'start' });
const [A, B] = [ca.player, cb.player];
const place = (p, x, z) => { p.protectedUntil = 0; Object.assign(p.mover, { x, y: 0, z, vx: 0, vy: 0, vz: 0, grounded: true, crouch: false }); }; // placed players are fair game
const settle = () => game.step(); // let the rewind history record new positions

let seq = 0;
const aim = (from, to, height) => ({
  yaw: Math.atan2(-(to.x - from.x), -(to.z - from.z)),
  pitch: Math.atan2(height - 1.6, Math.hypot(to.x - from.x, to.z - from.z)),
});
// Run ticks with Alice holding (or not) the trigger at a target height.
function run(ticks, fire, height) {
  for (let i = 0; i < ticks; i++) {
    const { yaw, pitch } = aim(A.mover, B.mover, height);
    A.receive({ t: 'input', s: ++seq, rt: game.tick, keys: 0, yaw, pitch, fire, shot: seq, slot: 0 }, performance.now());
    if (i === 0) A.receive({ t: 'input', s: ++seq, rt: game.tick, keys: 0, yaw, pitch, fire, shot: seq, slot: 0 }, performance.now());
    game.step();
  }
}
const events = (c, e) => c.out.filter((m) => m.t === 'event' && m.e === e);

// Head shot from 10 m in the open: rifle head damage 160, one tap.
place(A, -5, 10);
place(B, -5, 0);
settle();
const t0 = game.tick;
run(3, true, 1.65);
assert.equal(B.respawnAt, t0 + 1 + 180, 'killed on the first tick, respawn 3 s later');
const hit = events(ca, 'hit')[0];
assert.deepEqual([hit.a, hit.v, hit.dmg, hit.head], [A.id, B.id, 160, true]);
assert.equal(events(cb, 'hit').length, 1, 'the victim hears about it too');
const kill = events(cb, 'kill')[0];
assert.deepEqual([kill.k, kill.v, kill.w, kill.head], [A.id, B.id, 'rifle', true]);
assert.equal(B.alive, false);
assert.equal([B.deaths, A.kills].join(), '1,1');
assert.ok(events(cb, 'shot').length >= 1 && events(ca, 'shot').length === 0, 'shot events go to everyone but the shooter');
console.log('headshot one-tap ok');

// Respawn after 3 s at the spawn furthest from Alice.
const spawnsBefore = events(cb, 'spawn').length;
run(B.respawnAt - game.tick - 1, false, 1);
assert.equal(B.alive, false, 'still dead before 3 s');
run(1, false, 1);
assert.equal(B.alive, true, 'respawned');
const sp = events(cb, 'spawn').at(-1);
assert.equal(events(cb, 'spawn').length, spawnsBefore + 1);
const far = Math.max(...map.spawns.map(([x, , z]) => Math.hypot(x - A.mover.x, z - A.mover.z)));
assert.ok(Math.abs(Math.hypot(sp.x - A.mover.x, sp.z - A.mover.z) - far) < 1e-9, 'furthest spawn chosen');
assert.equal(B.hp, 100);
console.log('respawn furthest ok');

// Body shots: 40 each, so three to kill.
place(B, -5, 0);
settle();
const hitsBefore = events(ca, 'hit').length;
run(2, true, 0.8);
assert.equal(events(ca, 'hit').at(-1).dmg, 40);
assert.equal(events(ca, 'hit').at(-1).head, false);
run(20, true, 0.8);
assert.equal(B.alive, false);
assert.equal(events(ca, 'hit').length - hitsBefore, 3, 'exactly three body hits');
console.log('body damage ok');

// Walls block: Bob behind the divider at x = 8.
run(185, false, 1); // let Bob respawn
place(A, 12, -9);
place(B, 4, -9);
settle();
const hitsBeforeWall = events(ca, 'hit').length;
run(30, true, 1.2);
assert.equal(events(ca, 'hit').length, hitsBeforeWall, 'no hits through the wall');
console.log('wall blocks ok');
