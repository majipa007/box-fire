// Live: fighting bots roll random guns per life; counts kills per weapon
// until every registry gun has KILLS (2) kills, or MAXS (600) seconds pass.
// usage: BOTS=9 BOTARGS="--skill normal" [REPO=tree] serve.sh botmix.mjs
// NEED=gun,gun waits for those guns only (with BOTARGS="... --loadout p,s").
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = process.env.REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { GUN_IDS } = await import(pathToFileURL(path.join(REPO, 'shared/guns/index.js')).href);
const port = process.env.PORT, KILLS = Number(process.env.KILLS ?? 2), MAXS = Number(process.env.MAXS ?? 600);
const NEED = process.env.NEED?.split(',') ?? GUN_IDS;
const kills = Object.fromEntries(GUN_IDS.map((g) => [g, 0])), heads = { ...kills };
const ws = new WebSocket(`ws://localhost:${port}`);
let started = false;
ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: 'Watcher' }));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'lobby' && m.phase === 'lobby' && !started) { started = true; setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 300); }
  if (m.t === 'event' && m.e === 'kill' && m.w in kills) { kills[m.w]++; if (m.head) heads[m.w]++; }
};
const t0 = Date.now();
while (Date.now() - t0 < MAXS * 1000 && !NEED.every((g) => kills[g] >= KILLS)) {
  await new Promise((r) => setTimeout(r, 5000));
  console.log(`${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(kills));
}
console.log('kills', JSON.stringify(kills), 'heads', JSON.stringify(heads));
ws.close();
const missing = NEED.filter((g) => kills[g] < KILLS);
if (missing.length) { console.log('NO KILLS YET:', missing.join(' ')); process.exit(1); }
console.log(`kills with every gun of ${NEED.join(' ')}`);
