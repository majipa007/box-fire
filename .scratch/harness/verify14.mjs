// Ticket 14 check, in-process: loadout applies at the next spawn, and the
// shotgun's 12 pellets hit hard up close and weakly far away.
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
const events = (c, e) => c.out.filter((m) => m.t === 'event' && m.e === e);

// Pick the shotgun mid-life: nothing changes until the next spawn.
game.handle(ca, { t: 'loadout', primary: 'shotgun' });
assert.equal(A.arsenal.primary, 'rifle');
A.alive = false;
A.respawnAt = game.tick + 1;
game.step();
game.step();
assert.equal(A.alive, true);
assert.equal(A.arsenal.primary, 'shotgun');
assert.deepEqual(A.arsenal.mags, [5, 12]);
assert.equal(events(cb, 'spawn').at(-1).primary, 'shotgun', 'the spawn event names the primary');
console.log('loadout applies at the next spawn ok');

let seq = 0;
function blast(distance) {
  // A clear 24 m line down x = 5, Alice facing +z (yaw pi).
  place(A, 5, 11 - distance);
  place(B, 5, 11);
  B.hp = 100;
  B.alive = true;
  game.step(); // record positions for rewind
  A.arsenal.cooldown = 0;
  A.arsenal.mags[0] = 5;
  const before = events(ca, 'hit').length;
  const pitch = Math.atan2(1.0 - 1.6, distance); // centre mass
  A.receive({ t: 'input', s: ++seq, rt: game.tick, keys: 0, yaw: Math.PI, pitch, fire: true, shot: seq, slot: 0 }, performance.now());
  A.receive({ t: 'input', s: ++seq, rt: game.tick, keys: 0, yaw: Math.PI, pitch, fire: false, shot: seq, slot: 0 }, performance.now());
  game.step();
  game.step();
  const hits = events(ca, 'hit').slice(before);
  assert.ok(hits.length <= 1, 'one hit event per victim per shot, pellets summed');
  return hits[0]?.dmg ?? 0; // at range a 4° cone can miss entirely
}
const near = blast(4);
const far = blast(24);
console.log(`shotgun body damage: ${near} at 4 m, ${far} at 24 m`);
assert.ok(near >= 80, 'most pellets land up close');
assert.ok(far <= 12 * 2 && far < near / 3, 'beyond 20 m a pellet does 2 (a quarter)');
console.log('shotgun pellets and falloff ok');
