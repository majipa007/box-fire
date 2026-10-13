// Ticket 11 check, in-process: the impact a client computes for its own
// shot (seed, id, shot number, its own mover) equals the server's.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '/home/sukuna/personal_projects/game/server/game.js';
import { KEY } from '/home/sukuna/personal_projects/game/shared/movement.js';
import { shotDirs, eyeOf, traceShot } from '/home/sukuna/personal_projects/game/shared/weapons.js';
import { shotRng } from '/home/sukuna/personal_projects/game/shared/rng.js';
import { prepareMap } from '/home/sukuna/personal_projects/game/shared/collision.js';

const json = JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'));
const boxes = prepareMap(json).boxes;
const game = new Game('arena_01', json);
const conn = () => { const c = { loopback: true, rtt: 0, player: null, out: [] }; c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)) }; return c; };
const [ca, cb] = [conn(), conn()];
game.handle(ca, { t: 'join', name: 'Alice', bot: false });
game.handle(cb, { t: 'join', name: 'Bob', bot: false });
game.handle(ca, { t: 'start' });
const A = ca.player;
const B = cb.player;
Object.assign(B.mover, { x: 50, z: 50 }); // out of the way: shots hit the map
const seed = ca.out.find((m) => m.t === 'welcome').seed;

let seq = 0;
const send = (keys, fire, shot) => A.receive({ t: 'input', s: ++seq, rt: game.tick, keys, yaw: 2.2, pitch: 0.02, fire, shot, slot: 0 }, performance.now());
let mismatches = 0;
for (let k = 1; k <= 12; k++) {
  // Run for a while so spread is wide, then fire one shot numbered k.
  send(KEY.FORWARD, false, k - 1);
  send(KEY.FORWARD, false, k - 1);
  game.step();
  game.step();
  send(KEY.FORWARD, true, k);
  game.step();
  const ev = cb.out.filter((m) => m.t === 'event' && m.e === 'shot').at(-1);
  const [dir] = shotDirs(2.2, 0.02, 'rifle', A.mover, shotRng(seed, A.id, k));
  const origin = eyeOf(A.mover);
  const { t } = traceShot(origin, dir, boxes, []);
  const mine = origin.map((o, i) => Math.round((o + dir[i] * t) * 1000) / 1000);
  if (JSON.stringify(mine) !== JSON.stringify(ev.h[0])) mismatches++;
  game.step(); // let the cooldown pass
  for (let i = 0; i < 8; i++) { send(KEY.FORWARD, false, k); game.step(); }
}
assert.equal(mismatches, 0, `${mismatches} of 12 shots landed somewhere else on the server`);
console.log('12 moving shots: client-predicted impact == server impact for every one');
