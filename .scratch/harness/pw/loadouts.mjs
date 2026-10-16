// Live loadout smoke: every primary and every sidearm, picked through the
// loadout message the client sends on joining. For each pair the browser
// (re)joins with the pair saved, spawns, fires the primary (a scoped gun
// scopes first), switches to the sidearm and fires it. A watcher socket
// checks the server spawned the pair and fired each gun; the page's HUD must
// name the held gun and its predicted magazine must land on what the server
// fired, never jumping back up (a correction), with no movement correction.
// usage: REPO=<tree> PORT=n VIEW=960x540 serve.sh .scratch/harness/pw/loadouts.mjs
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.REPO ?? path.resolve(dir, '../../..');
const { GUNS, PRIMARIES, SECONDARIES } = await import(pathToFileURL(path.join(REPO, 'shared/guns/index.js')).href);
const port = process.env.PORT;
const out = process.env.OUT || path.join(process.env.WORK || '/home/sukuna/personal_projects/boxfire-work', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, timeout = 8000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(25)) if (fn()) return;
  throw new Error(`timed out waiting for: ${what}`);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const [vw, vh] = (process.env.VIEW || '960x540').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`error: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

// The watcher hosts (it joins first) and sees the tester's spawn and shot
// events (shots go to everyone but the shooter).
const seen = { spawns: [], shots: [], players: [], dropped: false };
let watcher;
const watch = () => new Promise((resolve) => {
  watcher = new WebSocket(`ws://localhost:${port}`);
  watcher.onopen = () => watcher.send(JSON.stringify({ t: 'join', name: 'Watcher' }));
  watcher.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') resolve();
    if (m.t === 'lobby') seen.players = m.players;
    if (m.t === 'lobby' && m.players.some((p) => p.id === me && !p.connected)) seen.dropped = true;
    if (m.t === 'event' && m.e === 'spawn') seen.spawns.push(m);
    if (m.t === 'event' && m.e === 'shot') seen.shots.push(m);
  };
});

const hud = () => page.evaluate(() => ({
  name: document.getElementById('wname').textContent,
  mag: Number(document.getElementById('mag').textContent),
  corr: Number(/corr (\d+) mm/.exec(document.getElementById('stats')?.textContent ?? '')?.[1] ?? 0),
}));

// Fire the held gun, sampling the HUD: autos hold for four rounds, anything else
// clicks three times, each press held until the predicted magazine drops
// (SwiftShader frames are slow, so a short press can fall between them).
async function fire(id) {
  const w = GUNS[id], samples = [];
  const sample = async () => { const h = await hud(); samples.push(h); return h; };
  if (w.scope) { await page.mouse.down({ button: 'right' }); await sleep(w.scope.inSeconds * 1000 + 300); }
  for (let c = 0; c < (w.mode === 'auto' ? 1 : 3); c++) {
    const before = (await sample()).mag;
    await page.mouse.down();
    if (w.mode === 'auto') for (const end = Date.now() + 4000; Date.now() < end && (await sample()).mag > before - 4; await sleep(60)); // a spray of four, not a tap
    else for (const end = Date.now() + 2000; Date.now() < end && (await sample()).mag >= before; await sleep(60));
    await page.mouse.up();
    const gap = w.mode === 'burst' ? w.burst.count / w.burst.rps + w.burst.delay : 1 / w.rps;
    for (const end = Date.now() + gap * 1000 + 100; Date.now() < end; await sleep(60)) await sample();
  }
  if (w.scope) await page.mouse.up({ button: 'right' });
  return samples;
}

// Wait until the HUD and the server's shot count have both held still for 1 s.
async function settle(count) {
  let last = '', since = Date.now();
  for (const end = Date.now() + 8000; Date.now() < end; await sleep(100)) {
    const h = await hud(), key = `${h.mag}/${count()}`;
    if (key !== last) { last = key; since = Date.now(); } else if (Date.now() - since >= 1000) return h;
  }
  return hud();
}

const results = [];
let me = null, drops = 0;
await watch();
const dump = async () => console.log(JSON.stringify({ spawns: seen.spawns.slice(-3), players: seen.players.map((p) => [p.id, p.name, p.connected]),
  joinError: await page.textContent('#join-error').catch(() => null), stats: await page.textContent('#stats').catch(() => null), problems }));
try {
// One pair, from the page load to the screenshot. Returns its two results.
async function runPair(i, primary, secondary) {
  const pair = { primary, secondary }, rs = [];
  await page.goto(`http://localhost:${port}/?debug`);
  await page.evaluate((s) => localStorage.setItem('boxfire.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('boxfire.settings') ?? '{}'), ...s })),
    { v: 2, quality: 'low', shadows: false, scale: 50, msaa: false, ...pair }); // the lightest render, so a loaded CPU still answers pings
  await page.reload();
  await page.fill('#name', 'Tester');
  const from = seen.spawns.length; // before the join: a rejoin past its respawn time spawns at once
  await page.click('#join-form button');
  if (i === 0) {
    await until('tester in the lobby', () => (me = seen.players.find((p) => p.name === 'Tester')?.id) != null);
    await sleep(300); // the loadout message follows the welcome
    watcher.send(JSON.stringify({ t: 'start' }));
  }
  await page.waitForSelector('#menu:not([hidden])', { timeout: 15000 });
  await until(`tester spawned with ${primary} + ${secondary}`, () => seen.spawns.slice(from).some((s) => s.id === me && s.primary === primary && s.secondary === secondary), 15000);
  seen.dropped = false; // the reload's own disconnect is over
  // The longest the page's main thread went without running a 50 ms timer.
  await page.evaluate(() => { let t = performance.now(); window.__stall = 0; setInterval(() => { const n = performance.now(); window.__stall = Math.max(window.__stall, n - t); t = n; }, 50); });
  await page.click('#play');
  await sleep(2200); // past spawn protection's blink and the first snapshots
  for (const [slot, id] of [[0, primary], [1, secondary]]) {
    if (slot === 1) { await page.keyboard.press('Digit2'); await sleep(700); }
    const shots0 = seen.shots.filter((s) => s.id === me && s.w === id).length;
    await page.evaluate(() => { window.__stall = 0; });
    const start = await hud();
    const samples = await fire(id);
    const count = () => seen.shots.filter((s) => s.id === me && s.w === id).length - shots0;
    const end = await settle(count);
    samples.push(end);
    const fired = count();
    const jumps = samples.filter((s, k) => k && s.mag > samples[k - 1].mag && s.mag !== GUNS[id].mag).length; // a refill other than a reload
    const r = { id, slot, fired, mag: `${start.mag} -> ${end.mag}`, name: end.name, corrMax: Math.max(...samples.map((s) => s.corr)), jumps, stall: Math.round(await page.evaluate(() => window.__stall)) };
    r.ok = fired > 0 && start.name === GUNS[id].name && end.name === GUNS[id].name && jumps === 0 && r.corrMax < 50
      && (end.mag === start.mag - fired || (GUNS[id].perShell && end.mag >= start.mag - fired) || end.mag === GUNS[id].mag);
    rs.push(r);
    console.log(JSON.stringify(r));
  }
  await page.evaluate(() => { document.getElementById('menu').hidden = true; });
  await page.screenshot({ path: path.join(out, `loadout-${primary}-${secondary}.png`) });
  return rs;
}

for (const [i, primary] of PRIMARIES.entries()) {
  const secondary = SECONDARIES[i % SECONDARIES.length];
  for (;;) {
    const rs = await runPair(i + drops, primary, secondary);
    // A starved headless page (SwiftShader on a loaded machine) can freeze for
    // seconds: its inputs then reach the server in a lump, past what the input
    // buffer keeps, and the netcode rightly corrects, or it stops answering
    // pings for DEAD_MS and is dropped while predicting alone. Neither is the
    // gun's fault, so a pair that failed through a freeze of over 1.5 s, or a
    // drop, runs again (a few times at most). A failure without one stands.
    if (!seen.dropped && rs.every((r) => r.ok || r.stall < 1500) || drops >= 6) { results.push(...rs); break; }
    drops++;
    console.log(JSON.stringify({ rerun: primary, dropped: seen.dropped, retry: drops }));
  }
}
} catch (e) {
  await dump();
  throw e;
}
watcher.close();
await browser.close();
const bad = results.filter((r) => !r.ok);
const guns = new Set(results.filter((r) => r.ok).map((r) => r.id));
console.log(JSON.stringify({ guns: guns.size, of: PRIMARIES.length + SECONDARIES.length, bad: bad.map((r) => r.id), drops, problems }));
process.exit(bad.length || problems.length || guns.size < PRIMARIES.length + SECONDARIES.length ? 1 : 0);
