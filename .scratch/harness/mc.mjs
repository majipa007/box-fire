// arsenal: Monte Carlo kill tables for every gun in the registry, through the
// real shared code (createArsenal, stepWeapon, shotDirs, traceShot, damageAt,
// scopedIn), so the tables are what the server would do.
//
// usage: node .scratch/harness/mc.mjs [trials=2000] [gun,gun,...]
//        REPO=<tree> to measure another checkout; MD=1 prints markdown tables.
//
// A shooter at eye height 1.6 m fights a standing target at each range. Each
// trial fires the gun the way it is meant to be fired, tick by tick through
// stepWeapon: autos hold the trigger, semis click as fast as the gun allows,
// a burst gun clicks as each burst comes up, a scoped gun scopes in first
// (the scope time is counted, see TTK below) and the shotgun pumps. A magazine that runs
// dry reloads and the reload counts. Recoil kick is client camera only and is
// assumed pulled down; the server's spread and bloom are all simulated.
// Conditions:
//   body  : aim at the body centre (1.0 m), standing still
//   human : body aim plus a 0.6° gaussian error per axis per shot
//   head  : aim at the head centre (1.65 m), standing still
//   move  : body aim while running at the gun's full pace
//   three : human aim at three 100 HP targets in a row (the magazine and
//           the reload count), the time to drop all three
// TTK is first shot to killing shot, the mean over the trials that killed
// (a median flips between 4 and 5 hits at the edges), plus a scoped
// gun's scope-in time (it must scope before it can fire scoped); '-' is
// under 50% killed within the time cap. Shield adds 60 to the 100 HP.
// TUNE='{"burst":{"dmg":24}}' tries numbers without editing the gun files.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = process.env.REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = (f) => import(pathToFileURL(path.join(REPO, f)).href);
const { WEAPONS, GUN_IDS, RUN_SPEED, TICK_RATE } = { ...(await mod('shared/constants.js')), ...(await mod('shared/guns/index.js')) };
const { createArsenal, stepWeapon, shotDirs, traceShot, damageAt, shotHeat, scopedIn, moveFactor, eyeOf } = await mod('shared/weapons.js');
const { KEY } = await mod('shared/movement.js');
const { shotRng } = await mod('shared/rng.js');

const TRIALS = Number(process.argv[2] ?? 2000);
const GUNS = process.argv[3]?.split(',') ?? GUN_IDS;
const RANGES = [2, 6, 12, 20, 30, 40];
const CONDS = { body: { y: 1.0, err: 0, run: false }, human: { y: 1.0, err: 0.6, run: false }, head: { y: 1.65, err: 0, run: false }, move: { y: 1.0, err: 0, run: true }, three: { y: 1.0, err: 0.6, run: false, n: 3 } };
const CAP_TICKS = 4 * TICK_RATE;
for (const [id, v] of Object.entries(JSON.parse(process.env.TUNE ?? '{}'))) Object.assign(WEAPONS[id], v); // the same objects the shared code reads
const DEG = Math.PI / 180;
let seed = 12345;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

// One fight: ticks from first shot (or the start of scoping in) to the shot
// that takes the last of `hp` from cond.n targets, or Infinity.
function fight(id, cond, range, hp) {
  const w = WEAPONS[id];
  const slot = w.slot === 'primary' ? 0 : 1;
  const a = w.slot === 'primary' ? createArsenal(id) : createArsenal('rifle', id);
  a.slot = slot;
  const m = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, crouch: false };
  const target = { id: 2, x: 0, y: 0, z: -range, crouch: false };
  const pitch0 = Math.atan2(cond.y - eyeOf(m)[1], range);
  const keys = w.scope ? KEY.AIM : 0;
  const trialSeed = (rand() * 2 ** 32) >>> 0;
  // Scope in first; the scope time is the gun's cost, listed apart.
  let scoping = 0;
  if (w.scope) for (; scoping < 200 && !scopedIn(a); scoping++) stepWeapon(a, { keys, fire: false, slot });
  let dealt = 0, first = -1, shot = 0, left = cond.n ?? 1;
  const cap = CAP_TICKS * (cond.n ?? 1);
  for (let t = 0; t < cap * 2; t++) {
    if (cond.run) m.vx = RUN_SPEED * moveFactor(a); // strafing at the pace the gun allows, read before the step as step() does
    // Autos hold; anything else clicks whenever the gun could fire this step.
    const ready = a.switching < 1e-9 && a.cooldown - 1 / TICK_RATE <= 1e-9 && (a.reload <= 1 / TICK_RATE + 1e-9 || (w.perShell && a.mags[slot] > 0));
    const fire = w.mode === 'auto' ? true : !a.trigger && ready;
    if (!stepWeapon(a, { keys, fire, slot })) continue;
    if (first < 0) first = t;
    shot++;
    const yaw = cond.err ? gauss() * cond.err * DEG : 0;
    const pitch = pitch0 + (cond.err ? gauss() * cond.err * DEG : 0);
    let dmg = 0;
    for (const dir of shotDirs(yaw, pitch, id, m, shotRng(trialSeed, 1, shot), shotHeat(a), scopedIn(a))) {
      const hit = traceShot(eyeOf(m), dir, [], [target]);
      if (hit.id !== null) dmg += damageAt(id, hit.head, hit.t);
    }
    dealt += Math.round(dmg); // the server rounds once per victim per shot
    if (dealt >= hp && --left === 0) return shot === 1 ? -(t - first + scoping) - 1 : t - first + scoping; // negative: the first shot killed
    if (dealt >= hp) dealt = 0; // the next target, at once
    if (t - first > cap) return Infinity;
  }
  return Infinity;
}

function cell(id, cond, range, hp) {
  const out = [];
  for (let i = 0; i < TRIALS; i++) out.push(fight(id, CONDS[cond], range, hp));
  const one = out.filter((t) => t < 0).length / out.length;
  for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = -out[i] - 1;
  const kills = out.filter(Number.isFinite);
  const mean = kills.reduce((sum, t) => sum + t, 0) / (kills.length || 1);
  return { ms: kills.length * 2 >= out.length ? Math.round((mean * 1000) / TICK_RATE) : Infinity, kill: kills.length / out.length, one };
}

const md = !!process.env.MD;
const fmt = (c) => (Number.isFinite(c.ms) ? String(c.ms) : '-');
const t0 = Date.now();
const all = {}; // id → cond → range → { ms, kill }
for (const id of GUNS) {
  all[id] = {};
  for (const cond of Object.keys(CONDS)) {
    all[id][cond] = {};
    for (const r of RANGES) all[id][cond][r] = cell(id, cond, r, 100);
  }
  all[id].shield = {};
  for (const r of RANGES) all[id].shield[r] = cell(id, 'body', r, 160);
}

const header = ['gun', ...RANGES.map((r) => `${r} m`)];
const line = (cells) => (md ? `| ${cells.join(' | ')} |` : cells.map((c, i) => String(c).padStart(i ? 7 : 22)).join(''));
console.log(`Kill tables: mean ms from first shot (scoped guns: from scoping in) to kill, ${TRIALS} trials a cell; '-' is no kill within 4 s (three: 12 s) in most trials.`);
for (const cond of [...Object.keys(CONDS), 'shield']) {
  console.log(`\n${md ? '#### ' : '== '}${cond}${cond === 'shield' ? ' (160 HP, body aim)' : ''}${md ? '' : ''}`);
  console.log(line(header));
  if (md) console.log(line(header.map(() => '---')));
  for (const id of GUNS) console.log(line([`${WEAPONS[id].name} (${id})`, ...RANGES.map((r) => fmt(all[id][cond][r]))]));
}

// The one-shot guns: how often the first shot alone kills, human body aim.
console.log(`\n${md ? '#### ' : '== '}one-shot: % of first shots that kill from 100 HP, human body aim`);
console.log(line(header));
if (md) console.log(line(header.map(() => '---')));
for (const id of GUNS) console.log(line([`${WEAPONS[id].name} (${id})`, ...RANGES.map((r) => Math.round(all[id].human[r].one * 100))]));

// Who wins each range: the fastest median per slot, and every gun within 10%
// of it. A gun with no cell anywhere is a gun with no niche.
console.log(`\n${md ? '#### ' : '== '}fastest per range (within 10% shares the cell)`);
const best = { primary: new Map(), secondary: new Map() };
for (const slot of ['primary', 'secondary']) {
  const ids = GUNS.filter((id) => WEAPONS[id].slot === slot);
  console.log(`${md ? '\n' : ''}${slot}`);
  console.log(line(['condition', ...RANGES.map((r) => `${r} m`)]));
  if (md) console.log(line(['---', ...RANGES.map(() => '---')]));
  for (const cond of Object.keys(CONDS)) {
    console.log(line([cond, ...RANGES.map((r) => {
      const top = Math.min(...ids.map((id) => all[id][cond][r].ms));
      if (!Number.isFinite(top)) return '-';
      const win = ids.filter((id) => all[id][cond][r].ms <= top * 1.1);
      for (const id of win) best[slot].set(id, (best[slot].get(id) ?? 0) + 1);
      return win.join('/');
    })]));
  }
  for (const id of ids) if (!best[slot].has(id)) console.log(`  NO NICHE: ${id} is never within 10% of the fastest ${slot}`);
}
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
