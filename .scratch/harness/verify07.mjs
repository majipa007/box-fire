// Ticket 07 check against the live server: a 200 ms network stall then a
// burst must not teleport the player, and a 600 ms silence must stop them,
// then re-sync when inputs resume.
import assert from 'node:assert/strict';
import { KEY } from '/home/sukuna/personal_projects/game/shared/movement.js';
import { encodeInput } from '/home/sukuna/personal_projects/game/shared/protocol.js';

const port = process.env.PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = new WebSocket(`ws://localhost:${port}`);
const snaps = [];
let spawn = null;
let id = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') id = m.id;
  if (m.t === 'snapshot') snaps.push(m);
  if (m.t === 'event' && m.e === 'spawn' && m.id === id) spawn = m;
};
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: 'join', name: 'Staller' }));
await sleep(100);
ws.send(JSON.stringify({ t: 'start' }));
await sleep(100);

let seq = 0;
const held = [];
const send = (keys) => held.push(encodeInput({ s: ++seq, rt: 0, keys, yaw: spawn.yaw, pitch: 0, fire: false, shot: 0, slot: 0 }));
const flush = () => { while (held.length) ws.send(held.shift()); };

// 1 s steady running, 200 ms stall (inputs keep being made but held), burst, 1 s more.
for (let i = 0; i < 60; i++) { send(KEY.FORWARD); flush(); await sleep(1000 / 60); }
for (let i = 0; i < 12; i++) { send(KEY.FORWARD); await sleep(1000 / 60); }
flush();
const burstAt = snaps.length;
for (let i = 0; i < 60; i++) { send(KEY.FORWARD); flush(); await sleep(1000 / 60); }

let maxStep = 0;
for (let i = burstAt; i < snaps.length; i++) {
  const [a, b] = [snaps[i - 1].me.mover, snaps[i].me.mover];
  maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.z - a.z) / (snaps[i].tick - snaps[i - 1].tick));
}
console.log(`after burst: max ${maxStep.toFixed(3)} m per tick (one step is ${(5.5 / 60).toFixed(3)})`);
assert.ok(maxStep <= (2 * 5.5) / 60 + 1e-6, 'never more than two steps of movement per tick');

// Silence: the player must coast to a stop and stay put.
await sleep(600);
const still = snaps.at(-1).me.mover;
await sleep(200);
const stillLater = snaps.at(-1).me.mover;
assert.equal(Math.hypot(stillLater.x - still.x, stillLater.z - still.z), 0, 'stopped while silent');
assert.equal(Math.hypot(still.vx, still.vz), 0);

// Resume with the seq carrying on: re-synced and moving again.
for (let i = 0; i < 30; i++) { send(KEY.BACK); flush(); await sleep(1000 / 60); } // away from any wall we ran into
await sleep(100);
const last = snaps.at(-1);
assert.ok(last.ack >= seq, 'resumed inputs are acknowledged (repeats may run past them)');
assert.ok(Math.hypot(last.me.mover.x - stillLater.x, last.me.mover.z - stillLater.z) > 1, 'moving again');
console.log('stall, neutral and re-sync ok');
ws.close();
