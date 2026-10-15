// smoke.mjs steps: the pad cue, solo, with POWER_KIT=shunt,bolt,mine on the
// server (every life starts full). Usage:
//   POWER_KIT=shunt,bolt,mine REPO=... PORT=... OUT=... VIEW=640x360 serve.sh pw/smoke.mjs pf-cue <this file>
// (a) walk onto an up pad holding 3: #padcue 'full', cues.full +1.
// (b) Q: within 1.5 s cues.own +1, inventory back to 3, #padcue hidden.
// (c) step off, use 2, walk back on: "REFILLING ..." and cues.empty +1.
// (d) stand there until it refills: cues.own +1, #padcue hidden within 500 ms,
//     cues.empty never rises again (the latch).
import path from 'node:path';
const out = process.env.OUT;
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)} ms]`, ...a);
export default async function (page) {
const fails = [];
const check = (ok, what) => { log(ok ? 'OK  ' : 'FAIL', what); if (!ok) fails.push(what); };
// The nearest pad on our floor with a clear straight walk, 20 s pads first.
const choose = (map) => page.evaluate(async (map) => {
  const { self } = await import('/net.js');
  const { prepareMap } = await import('/shared/collision.js');
  const { clearLine } = await import('/shared/powerups.js');
  const m = prepareMap(await (await fetch(`/shared/maps/${map}.json`)).json());
  const from = [self.mover.x, self.mover.y, self.mover.z];
  let best = -1;
  let bestScore = Infinity;
  m.pads.forEach((p, ti) => {
    const [tx, ty, tz] = p.pos;
    if (Math.abs(ty - from[1]) > 0.1) return;
    const L = Math.hypot(tx - from[0], tz - from[2]);
    if (L < 5) return;
    const ux = (tx - from[0]) / L;
    const uz = (tz - from[2]) / L;
    for (const s of [-0.35, 0, 0.35]) for (const h of [0.3, 1.0, 1.7]) {
      if (!clearLine([from[0] - uz * s, from[1] + h, from[2] + ux * s], [tx + ux * 2.5 - uz * s, ty + h, tz + uz * 2.5 + ux * s], m.boxes)) return;
    }
    const crosses = m.pads.some((q, i) => i !== ti && (() => {
      const along = (q.pos[0] - from[0]) * ux + (q.pos[2] - from[2]) * uz;
      return along > 0 && along < L + 7 && Math.abs((q.pos[0] - from[0]) * uz - (q.pos[2] - from[2]) * ux) < 1.6;
    })());
    const score = L + (p.pool.length > 1 ? 100 : 0) + (p.respawn > 20 ? 60 : 0);
    if (!crosses && score < bestScore) [best, bestScore] = [ti, score];
  });
  return { best, from, pad: best >= 0 ? m.pads[best] : null };
}, map);
const state = () => page.evaluate(async () => {
  const { self } = await import('/net.js');
  const pu = await import('/powerups.js');
  const el = document.getElementById('padcue');
  return { x: self.mover.x, z: self.mover.z, alive: self.alive, inv: self.pw?.inv.length ?? 0, cue: pu.padCue().state, pad: pu.padCue().pad, cues: { ...pu.cues }, chip: el.hidden ? '' : `${el.className}|${el.textContent}` };
});
const setLook = (yaw, pitch) => page.evaluate(async ([yaw, pitch]) => { const { look } = await import('/input.js'); look.yaw = yaw; look.pitch = pitch; }, [yaw, pitch]);

let r = null;
for (let tries = 0; tries < 8; tries++) {
  if (tries) { // no straight walk from this spawn: rejoin under the same name for another
    await page.reload();
    await page.fill('#name', 'Tester');
    await page.click('#join-form button');
    await page.waitForTimeout(600);
    if (await page.isVisible('#start')) await page.click('#start');
    await page.waitForSelector('#menu:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(1500);
  }
  await page.click('#play');
  await page.waitForTimeout(400);
  const mapId = await page.evaluate(async () => ((await import('/powerups.js')).padStates()[0].pos[1] > 0.6 ? 'arena_02' : 'arena_01'));
  r = await choose(mapId);
  log('map', mapId, 'spawn', r.from.map((v) => v.toFixed(1)).join(','), 'pad', r.best, JSON.stringify(r.pad));
  if (r.best >= 0) break;
}
if (r.best < 0) throw new Error('no walkable pad from 8 spawns');
const target = r.best;
const [px, , pz] = r.pad.pos;
let s = await state();
const L0 = Math.hypot(px - s.x, pz - s.z);
const [ux, uz] = [(px - s.x) / L0, (pz - s.z) / L0];
const dist = (st) => Math.hypot(px - st.x, pz - st.z);
const yawTo = Math.atan2(-ux, -uz);
await setLook(yawTo, -0.25);
// Face the pad on every poll (W walks on, S backs off), so a diagonal
// approach can't drift out of the 1.1 m reach; stop on the real distance.
// At walk speed (Shift), so a poll can't skip the stop zone and run us
// through the pad and back: every re-entry is a fresh cue.
async function walk(key, done) {
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down(key);
  for (let i = 0; i < 600 && !done((s = await state())); i++) {
    if (dist(s) > 0.3) await setLook(Math.atan2(-(px - s.x), -(pz - s.z)), -0.25);
    await page.waitForTimeout(15);
  }
  await page.keyboard.up(key);
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(400);
  s = await state();
}
const use = async () => { await setLook(yawTo, 0.6); await page.keyboard.down('KeyQ'); await page.waitForTimeout(120); await page.keyboard.up('KeyQ'); /* held: a tap can fall between frames */ await page.waitForTimeout(1300); await setLook(yawTo, -0.25); };
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

// (a)
check(s.inv === 3, `kit: 3 items (${s.inv})`);
const c0 = s.cues;
await walk('KeyW', (st) => dist(st) < 0.6); // stop short: the slide carries us to the centre
await page.waitForTimeout(300);
s = await state();
log(JSON.stringify(s));
check(s.cue === 'full' && s.chip.startsWith('panel full|INVENTORY FULL') && s.cues.full === c0.full + 1, `(a) full pad: '${s.chip}', pad ${s.pad}, d ${dist(s).toFixed(2)} m`);
await shot('cue-a-full');
// (b)
await setLook(yawTo, 0.6);
await page.keyboard.down('KeyQ'); await page.waitForTimeout(120); await page.keyboard.up('KeyQ'); // held: a tap can fall between frames
let got = false;
for (let i = 0; i < 30 && !got; i++) { await page.waitForTimeout(50); s = await state(); got = s.cues.own === c0.own + 1; }
await page.waitForTimeout(150);
s = await state();
log(JSON.stringify(s));
check(got && s.inv === 3 && s.chip === '', `(b) Q on the pad: own +1, inv ${s.inv}, chip '${s.chip}'`);
await setLook(yawTo, -0.25);
// (c)
await walk('KeyS', (st) => dist(st) > 2.6);
await use();
await use();
s = await state();
const c1 = s.cues;
check(s.inv === 1 && s.cue === '', `(c) off the pad, 1 item (${s.inv}), d ${dist(s).toFixed(2)} m`);
await walk('KeyW', (st) => dist(st) < 0.6); // stop short: the slide carries us to the centre
await page.waitForTimeout(300);
s = await state();
log(JSON.stringify(s));
check(s.cue === 'refill' && /^panel\|REFILLING (\d+s|\d:\d\d)$/.test(s.chip) && s.cues.empty === c1.empty + 1, `(c) refilling pad: '${s.chip}', pad ${s.pad}, d ${dist(s).toFixed(2)} m`);
await shot('cue-c-refill');
await setLook(yawTo, -1.3);
await page.waitForTimeout(300);
await shot('cue-c-refill-down');
// (d)
let at = null;
let hiddenAt = null;
for (let i = 0; i < 1600 && hiddenAt === null; i++) {
  await page.waitForTimeout(50);
  s = await state();
  if (!s.alive) break;
  if (at === null && s.cues.own === c1.own + 1) at = Date.now();
  if (at !== null && s.chip === '') hiddenAt = Date.now();
  if (i % 100 === 0) log('waiting', s.chip, JSON.stringify(s.cues));
}
await page.waitForTimeout(1500);
s = await state();
log(JSON.stringify(s));
check(at !== null && hiddenAt - at <= 500, `(d) refilled under us: own +1, chip hidden after ${hiddenAt - at} ms`);
check(s.cues.empty === c1.empty + 1 && s.cue === '' && s.chip === '', `(d) no false 'refill' after the grab: empty ${s.cues.empty - c1.empty}, chip '${s.chip}'`);
await shot('cue-d-after');
if (fails.length) throw new Error(`pad cue smoke: ${fails.join('; ')}`);
log('CUE OK');
}
