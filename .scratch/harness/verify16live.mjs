// Ticket 16 live check: a real socket closes, the same name reconnects and
// gets the same id back; an active name is refused. Waits for conditions
// instead of fixed sleeps, so a busy machine can't make it flaky.
import assert from 'node:assert/strict';
const port = process.env.PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, timeout = 3000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(20)) if (fn()) return;
  assert.fail(`timed out waiting for: ${what}`);
}
function client(name) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const c = { ws, out: [], last: (t) => [...c.out].reverse().find((m) => m.t === t) };
  ws.onmessage = (e) => c.out.push(JSON.parse(e.data));
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
  return c;
}
const a = client('Alice');
await until('Alice welcomed', () => a.last('welcome'));
const b = client('Bob');
await until('Bob welcomed', () => b.last('welcome'));
a.ws.send(JSON.stringify({ t: 'start' }));
await until('match started', () => a.last('lobby')?.phase === 'playing');
const bobId = b.last('welcome').id;
b.ws.close();
await until('Bob greyed out', () => a.last('lobby')?.players.find((p) => p.id === bobId)?.connected === false);
const b2 = client('BOB');
await until('BOB welcomed', () => b2.last('welcome'));
assert.equal(b2.last('welcome').id, bobId, 'same player back');
const dup = client('alice');
await until('alice answered', () => dup.last('reject') || dup.last('welcome'));
assert.equal(dup.last('reject')?.reason, 'name-taken', 'live name refused');
console.log('live rejoin ok');
for (const c of [a, b2, dup]) c.ws.close();
