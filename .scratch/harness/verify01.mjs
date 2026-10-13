// Ticket 01 check: static serving, path safety, join/reject, host election,
// start, malformed input, heartbeat pings. Run with the server already up.
import os from 'node:os';
import assert from 'node:assert/strict';

const port = process.env.PORT;
const base = `http://localhost:${port}`;
const lan = Object.values(os.networkInterfaces()).flat().find((a) => a.family === 'IPv4' && !a.internal)?.address;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function status(path) { const r = await fetch(base + path); return [r.status, r.headers.get('content-type')]; }
assert.deepEqual((await status('/'))[0], 200);
assert.match((await status('/main.js'))[1], /javascript/);
assert.equal((await status('/shared/protocol.js'))[0], 200);
for (const p of ['/../server/index.js', '/shared/..%2f..%2fserver%2findex.js', '/%00', '/package.json', '/shared//etc/passwd', '/shared/']) {
  assert.equal((await status(p))[0], 404, p);
}
console.log('static ok');

function client(host = 'localhost') {
  const ws = new WebSocket(`ws://${host}:${port}`);
  const c = { ws, msgs: [], last: (t) => [...c.msgs].reverse().find((m) => m.t === t) };
  ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
  c.open = new Promise((r) => (ws.onopen = r));
  c.send = (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  return c;
}

const remote = client(lan); // non-loopback, joins first
await remote.open;
remote.send({ t: 'join', name: 'Remote' });
await sleep(100);
assert.equal(remote.last('lobby').host, remote.last('welcome').id, 'only player is host');

const a = client(); await a.open;
a.send({ t: 'join', name: '  Alice ' });
await sleep(100);
const aId = a.last('welcome').id;
assert.equal(a.last('lobby').host, aId, 'loopback player takes host');
assert.equal(a.last('lobby').players.find((p) => p.id === aId).name, 'Alice');

const dup = client(); await dup.open;
dup.send({ t: 'join', name: 'ALICE' });
await sleep(100);
assert.equal(dup.last('reject').reason, 'name-taken');

const bot = client(); await bot.open;
bot.send({ t: 'join', name: 'bot1', bot: true });
await sleep(100);
assert.equal(a.last('lobby').host, aId, 'bots never host');

// garbage and oversized input must not crash the host
dup.send('not json'); dup.send('{"t":"start"}'); dup.send('x'.repeat(10000));
remote.send({ t: 'start' }); // not host: ignored
await sleep(100);
assert.equal(a.last('lobby').phase, 'lobby');

await sleep(1600); // heartbeat pings land in the lobby refresh
assert.ok(a.last('lobby').players.every((p) => Number.isFinite(p.ping)), 'pings present');

a.send({ t: 'start' });
await sleep(100);
assert.equal(remote.last('lobby').phase, 'playing');

a.ws.close();
await sleep(150);
assert.equal(remote.last('lobby').host, remote.last('welcome').id, 'host passes to longest-connected');
assert.equal((await status('/'))[0], 200, 'server still alive');
console.log('lobby ok');
for (const c of [remote, dup, bot]) c.ws.close();
