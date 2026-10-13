// Ticket 10 check, in-process: a strafing target is hit where the shooter
// saw it (its render tick), not where the server has it now.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '/home/sukuna/personal_projects/game/server/game.js';
import { KEY } from '/home/sukuna/personal_projects/game/shared/movement.js';

const map = JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'));
const conn = (loopback) => {
  const c = { loopback, rtt: 0, player: null, out: [] };
  c.ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (d) => c.out.push(JSON.parse(d)) };
  return c;
};

function trial(aimAtRenderTick) {
  const game = new Game('arena_01', map);
  const [ca, cb] = [conn(true), conn(false)];
  game.handle(ca, { t: 'join', name: 'Alice', bot: false });
  game.handle(cb, { t: 'join', name: 'Bob', bot: false });
  game.handle(ca, { t: 'start' });
  const [A, B] = [ca.player, cb.player];
  Object.assign(A.mover, { x: -5, y: 0, z: 13, vx: 0, vz: 0 });
  Object.assign(B.mover, { x: -6, y: 0, z: 3, vx: 0, vz: 0 });
  B.protectedUntil = 0; // a clear lane: nothing between x -6 and -2 at z 3
  let sa = 0;
  let sb = 0;
  const seen = []; // Bob's x per tick, as a client would see it in snapshots
  for (let i = 0; i < 40; i++) {
    // Bob strafes +x at run speed (yaw 0, RIGHT is +x).
    B.receive({ t: 'input', s: ++sb, rt: 0, keys: KEY.RIGHT, yaw: 0, pitch: 0, fire: false, shot: 0, slot: 0 }, performance.now());
    const fire = i === 30;
    const rt = game.tick - 5.5; // drawn 5.5 ticks behind: 0.5 m back, far more than head + spread
    const bx = aimAtRenderTick ? seen[Math.floor(rt)] + (seen[Math.floor(rt) + 1] - seen[Math.floor(rt)]) * 0.5 : B.mover.x;
    const yaw = Math.atan2(-(bx - A.mover.x), -(B.mover.z - A.mover.z));
    const pitch = Math.atan2(1.65 - 1.6, Math.hypot(bx - A.mover.x, B.mover.z - A.mover.z));
    A.receive({ t: 'input', s: ++sa, rt, keys: 0, yaw, pitch, fire, shot: 0, slot: 0 }, performance.now());
    game.step();
    seen[game.tick] = B.mover.x;
  }
  return ca.out.filter((m) => m.t === 'event' && m.e === 'hit');
}

const rewound = trial(true);
assert.equal(rewound.length, 1, 'aiming where Bob was drawn hits');
assert.equal(rewound[0].head, true, 'a headshot');
console.log('aim at the drawn position: hit (head)');
const current = trial(false);
assert.equal(current.filter((h) => h.head).length, 0, 'aiming at the server-current position misses the head');
console.log('aim at the server position instead: no headshot (moved ~0.5 m)');
