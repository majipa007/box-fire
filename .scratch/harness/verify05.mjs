// Ticket 05 check: inputs up, snapshots down, acks advance, and the server's
// authoritative state equals a local prediction of the same inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { step, createMover, KEY } from '/home/sukuna/personal_projects/game/shared/movement.js';
import { prepareMap } from '/home/sukuna/personal_projects/game/shared/collision.js';
import { encodeInput } from '/home/sukuna/personal_projects/game/shared/protocol.js';

const port = process.env.PORT;
const boxes = prepareMap(JSON.parse(fs.readFileSync('/home/sukuna/personal_projects/game/shared/maps/arena_01.json'))).boxes;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(`ws://localhost:${port}`);
const msgs = [];
ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: 'join', name: 'Mover' }));
await sleep(100);
const id = msgs.find((m) => m.t === 'welcome').id;
ws.send(JSON.stringify({ t: 'start' }));
await sleep(100);
const spawn = msgs.find((m) => m.t === 'event' && m.e === 'spawn' && m.id === id);
assert.ok(spawn, 'spawned on start');

// Predict locally while sending 120 inputs (2 s) at 60 Hz: forward, with a jump.
const me = { ...createMover(spawn.x, spawn.y, spawn.z), grounded: true };
let seq = 0;
for (let i = 0; i < 120; i++) {
  const inp = { s: ++seq, rt: 0, keys: KEY.FORWARD | (i === 30 ? KEY.JUMP : 0), yaw: spawn.yaw, pitch: 0, fire: false, shot: 0, slot: 0 };
  step(me, inp, boxes);
  ws.send(encodeInput(inp));
  await sleep(1000 / 60);
}
await sleep(300);
const snaps = msgs.filter((m) => m.t === 'snapshot');
const last = snaps.find((m) => m.ack === seq); // before the 250 ms neutral rule kicks in
assert.ok(last, 'every input acknowledged');
assert.deepEqual(last.me.mover, me, 'server state equals local prediction exactly');
const moved = Math.hypot(me.x - spawn.x, me.z - spawn.z);
assert.ok(moved > 3, `moved ${moved.toFixed(2)} m`); // sanity only: a random spawn may run into a wall
const rate = snaps.length / ((snaps.length && 2.7) || 1);
console.log(`snapshots: ${snaps.length} in ~2.7 s (${rate.toFixed(0)}/s), moved ${moved.toFixed(2)} m, ack ${last.ack}`);
assert.ok(last.ps.some((p) => p[0] === id), 'own entry in public list');
ws.close();
