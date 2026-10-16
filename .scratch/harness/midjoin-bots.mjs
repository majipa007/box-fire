// Live: a host starts a match, then the real tools/bot.js joins mid-match.
// Each bot's first spawn must carry the pair the bot printed (the pick rides
// on join, because attach() spawns a mid-match joiner at once).
// usage: [REPO=tree] PORT=n serve.sh .scratch/harness/midjoin-bots.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as run } from 'node:child_process';
const port = process.env.PORT, repo = process.env.REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = new WebSocket(`ws://localhost:${port}`); const first = new Map(); const names = new Map();
host.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'lobby') for (const p of m.players) names.set(p.id, p.name);
  if (m.t === 'event' && m.e === 'spawn' && !first.has(m.id)) first.set(m.id, [m.primary, m.secondary]);
};
await new Promise((r) => (host.onopen = r));
host.send(JSON.stringify({ t: 'join', name: 'Host' })); await sleep(300);
host.send(JSON.stringify({ t: 'start' })); await sleep(500);
const bots = run('node', ['tools/bot.js', '--count', '6', '--passive'], { cwd: repo, env: { ...process.env, PORT: port } });
let out = ''; bots.stdout.on('data', (d) => (out += d));
await sleep(4000); bots.kill();
const said = Object.fromEntries([...out.matchAll(/^(bot\d+): passive, (\w+) \+ (\w+)/gm)].map((m) => [m[1], [m[2], m[3]]]));
let bad = 0;
const idOf = new Map([...names].map(([id, n]) => [n, id]));
for (const [n, pair] of Object.entries(said)) {
  const got = first.get(idOf.get(n)), ok = got?.join() === pair.join(); bad += !ok;
  console.log(n, 'printed', pair.join('+'), 'first spawn', got?.join('+') ?? 'none', ok ? 'OK' : 'MISMATCH');
}
console.log(Object.keys(said).length, 'bots,', bad, 'mismatches');
process.exit(bad || Object.keys(said).length < 6 ? 1 : 0);
