// Power-ups, the server side (docs/bible.md §4): pads and pickups, the
// entities in play (Shunts, Mines, Shock domes), Bolt's rewound hitscan,
// Barge, and the damage and knocks they queue. The shared inventory step
// (shared/powerups.js) decides what is used and when; Game calls use() for
// it, shot() per bullet, step() once per tick and snapshot() for the wire.
import {
  TICK_RATE, POWERS, POWER_PADS, POWER_PAD_BOX, POWER_CAPACITY, PLAYER_WIDTH, STAND_HEIGHT, CROUCH_HEIGHT, HISTORY_TICKS,
} from '../shared/constants.js';
import { knock } from '../shared/movement.js';
import { createPowers, falloff, pushScale, domeCentres, chestOf, clearLine, lockTarget, padRespawnTicks } from '../shared/powerups.js';
import { eyeOf, aimDir, traceShot } from '../shared/weapons.js';
import { rayBox, overlaps } from '../shared/collision.js';
import { byScore, POWER_IDS, ENT, PU_STATE } from '../shared/protocol.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const heightOf = (m) => (m.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
const SHUNT_STEP = POWERS.shunt.speed / TICK_RATE; // 0.3 m per tick
const SHUNT_TURN = (POWERS.shunt.turn * Math.PI) / 180 / TICK_RATE; // rad per tick
const SHUNT_BLIND = ticks(0.5); // ticks out of sight before the lock drops
const SHOCK_AHEAD = 15; // m: domes with no target land this far along the aim
const SHOCK_REACH = [-1, 2.5]; // m: a victim's feet this far below or above a dome
const BACKOFF = 0.1; // m: a Shunt bursts this far short of the wall, so its splash sees out
const DOWN = [0, -1, 0];
// Dev aid: `POWER_KIT=shunt,bolt,mine npm start` hands every new life these.
const KIT = (process.env.POWER_KIT ?? '').split(',').filter((k) => POWER_IDS.includes(k)).slice(0, POWER_CAPACITY);

// A new life's power state (empty, or the dev kit).
export function freshPowers() {
  const pw = createPowers();
  pw.inv.push(...KIT);
  return pw;
}

// Distance from point p to a mover's box (0 inside it).
function boxDist(p, m) {
  const r = PLAYER_WIDTH / 2;
  const dx = Math.max(m.x - r - p[0], 0, p[0] - m.x - r);
  const dy = Math.max(m.y - p[1], 0, p[1] - m.y - heightOf(m));
  const dz = Math.max(m.z - r - p[2], 0, p[2] - m.z - r);
  return Math.hypot(dx, dy, dz);
}

export class PowerServer {
  constructor(game) {
    this.game = game;
    // Pads live in constants.js for arena_01; other maps (tests) have none.
    this.pads = (game.mapId === 'arena_01' ? POWER_PADS : []).map((pad) => {
      const [x, y, z] = pad.pos;
      const [w, h, d] = POWER_PAD_BOX;
      return { ...pad, box: { min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2] }, idx: 0, readyAt: 0, span: 0 };
    });
    this.reset();
  }

  // A new match: every pad up at its pool's first item, nothing in play.
  reset() {
    this.ents = []; // { eid, type, by, x, y, z, gone, ... }
    this.queue = []; // hits waiting for the end of the tick
    this.nextId = 1;
    for (const pad of this.pads) Object.assign(pad, { idx: 0, readyAt: 0, span: 0 });
  }

  // p's inventory step just used `kind` (or fired a Bolt shot) on this input.
  use(p, kind, input) {
    const { game } = this;
    const m = p.mover;
    if (kind !== 'bolt' || p.pw.bolts === POWERS.bolt.shots - 1) {
      game.broadcast({ t: 'event', e: 'use', id: p.id, k: kind, x: r2(m.x), y: r2(m.y), z: r2(m.z), tick: game.tick });
    }
    const eye = eyeOf(m);
    const dir = aimDir(input.yaw, input.pitch);
    if (kind === 'shunt') this.launch(p, eye, dir);
    else if (kind === 'bolt') this.bolt(p, eye, dir, input.rt);
    else if (kind === 'barge') this.barge(p);
    else if (kind === 'shock') this.shock(p, dir);
    else if (kind === 'mine') this.drop(p);
  }

  // A bullet (or Bolt) from p along dir that stops at maxT: the nearest
  // enemy Shunt (a cube at its rewound position) fizzles, or the nearest
  // Mine goes off, credited to p.
  shot(p, origin, dir, maxT, rt) {
    let best = null;
    let bestT = maxT;
    const min = [0, 0, 0];
    const max = [0, 0, 0];
    for (const e of this.ents) {
      if (e.gone) continue;
      let size;
      let at;
      if (e.type === ENT.MINE) {
        size = POWERS.mine.box;
        at = [e.x, e.y + size[1] / 2, e.z];
      } else if (e.type === ENT.SHUNT && e.by !== p) {
        const b = POWERS.shunt.box;
        size = [b, b, b];
        at = this.rewind(e, rt);
        if (!at) continue;
      } else continue;
      for (let a = 0; a < 3; a++) {
        min[a] = at[a] - size[a] / 2;
        max[a] = at[a] + size[a] / 2;
      }
      const t = rayBox(origin, dir, min, max);
      if (t < bestT) {
        best = e;
        bestT = t;
      }
    }
    if (best?.type === ENT.MINE) this.detonateMine(best, p);
    else if (best) this.fizzle(best, p);
  }

  // Once per tick, after every player's inputs: pickups, Shunts, mines,
  // domes, then the hits queued this tick, in order.
  step() {
    const { tick, players } = this.game;
    let n = 0;
    for (const p of players.values()) if (p.mover) n++;
    this.pads.forEach((pad, i) => {
      if (pad.readyAt > tick) return;
      for (const p of players.values()) {
        if (!p.alive || p.pw.inv.length >= POWER_CAPACITY || !overlaps(p.mover, PLAYER_WIDTH / 2, heightOf(p.mover), [pad.box])) continue;
        const k = pad.pool[pad.idx];
        p.pw.inv.push(k);
        pad.idx = (pad.idx + 1) % pad.pool.length;
        pad.span = padRespawnTicks(pad, n);
        pad.readyAt = tick + pad.span;
        this.game.broadcast({ t: 'event', e: 'pick', id: p.id, pad: i, k, tick });
        return;
      }
    });
    for (const e of this.ents) if (!e.gone && e.type === ENT.SHUNT) this.stepShunt(e);
    for (const e of this.ents) if (!e.gone && e.type === ENT.MINE) this.stepMine(e);
    for (const e of this.ents) if (!e.gone && e.type === ENT.DOME && tick >= e.strikeAt) this.strike(e);
    for (const h of this.queue) this.apply(h);
    this.queue.length = 0;
    if (this.ents.some((e) => e.gone)) this.ents = this.ents.filter((e) => !e.gone);
  }

  // The `pu` part of a snapshot, as JSON: pads, then entities.
  snapshot() {
    const { tick } = this.game;
    const pd = this.pads.map((p) => [POWER_IDS.indexOf(p.pool[p.idx]), p.readyAt > tick ? p.readyAt : 0, p.span]);
    const en = this.ents.map((e) => {
      let a = 0;
      let b = 0;
      if (e.type === ENT.SHUNT) a = e.target ?? 0;
      else if (e.type === ENT.MINE) a = e.fuseAt ? PU_STATE.FUSED : tick >= e.armAt ? PU_STATE.ARMED : PU_STATE.ARMING;
      else {
        a = e.strikeAt;
        b = e.target;
      }
      return [e.eid, e.type, e.by.id, r2(e.x), r2(e.y), r2(e.z), a, b];
    });
    return JSON.stringify({ pd, en });
  }

  // ---- Uses ----

  // Shunt: a homing rocket from the eye, locked at launch on the enemy
  // nearest the crosshair (or none: it flies straight).
  launch(p, eye, dir) {
    const { tick, players, map } = this.game;
    const foes = [];
    for (const q of players.values()) if (q !== p && q.alive && tick >= q.protectedUntil) foes.push({ id: q.id, ...q.mover });
    const e = {
      eid: this.nextId++, type: ENT.SHUNT, by: p, x: eye[0], y: eye[1], z: eye[2], dir: [...dir],
      target: lockTarget(eye, dir, foes, map.boxes), blind: 0, dieAt: tick + ticks(POWERS.shunt.life), hist: [],
    };
    e.hist.push([tick, e.x, e.y, e.z]);
    this.ents.push(e);
  }

  // Bolt: one rewound hitscan shot along this input's exact aim.
  bolt(p, eye, dir, rt) {
    const { game } = this;
    const targets = game.history.at(rt, game.tick).filter((q) => q.id !== p.id && game.players.get(q.id)?.alive);
    const hit = traceShot(eye, dir, game.map.boxes, targets);
    this.shot(p, eye, dir, hit.t, rt);
    game.broadcast({ t: 'event', e: 'shot', id: p.id, w: 'bolt', o: eye.map(r3), h: [eye.map((o, i) => r3(o + dir[i] * hit.t))] }, p);
    if (hit.id !== null) this.queue.push({ by: p, q: game.players.get(hit.id), dmg: POWERS.bolt.dmg, w: 'bolt' });
  }

  // Barge: a wave from the chest that pushes and hurts everyone in sight
  // around the user and clears enemy Shunts and Mines.
  barge(p) {
    const { radius, dmgMax, dmgMin, knock: push, lift } = POWERS.barge;
    const c = chestOf(p.mover);
    this.boom('barge', c, radius, p, 0);
    this.splash(p, 'barge', c, radius, dmgMax, dmgMin, push, lift, null);
    for (const e of this.ents) {
      if (e.gone || e.by === p || e.type === ENT.DOME) continue;
      if (Math.hypot(e.x - c[0], e.y - c[1], e.z - c[2]) <= radius) this.fizzle(e, p);
    }
  }

  // Shock: three domes ahead of the leader (skipping the user), striking at
  // 1.2, 1.6 and 2.0 s; with nobody to target, 15 m along the aim.
  shock(p, dir) {
    const { tick, players } = this.game;
    const [target] = [...players.values()].filter((q) => q !== p && q.alive).sort(byScore);
    const m = target?.mover;
    const h = Math.hypot(dir[0], dir[2]) || 1;
    const centres = m
      ? domeCentres(m.x, m.y, m.z, m.vx, m.vz)
      : domeCentres(p.mover.x + (dir[0] / h) * SHOCK_AHEAD, p.mover.y, p.mover.z + (dir[2] / h) * SHOCK_AHEAD, 0, 0);
    const cast = new Set(); // ids already struck by this cast
    const { lead, step } = POWERS.shock;
    centres.forEach(([x, y, z], i) => {
      this.ents.push({ eid: this.nextId++, type: ENT.DOME, by: p, x, y, z, strikeAt: tick + ticks(lead + i * step), target: target?.id ?? 0, cast });
    });
  }

  // Mine: dropped onto the surface under the feet. The owner's third
  // replaces the oldest.
  drop(p) {
    const { tick, map } = this.game;
    const m = p.mover;
    const from = [m.x, m.y + 0.01, m.z];
    let t = Infinity;
    for (const b of map.boxes) t = Math.min(t, rayBox(from, DOWN, b.min, b.max));
    const mine = POWERS.mine;
    const own = this.ents.filter((e) => !e.gone && e.type === ENT.MINE && e.by === p);
    if (own.length >= mine.perOwner) this.fizzle(own[0], p);
    this.ents.push({
      eid: this.nextId++, type: ENT.MINE, by: p, x: m.x, y: Number.isFinite(t) ? from[1] - t : m.y, z: m.z,
      armAt: tick + ticks(mine.arm), fuseAt: 0, dieAt: tick + ticks(mine.life),
    });
  }

  // ---- Entities ----

  stepShunt(e) {
    const { tick, players, map } = this.game;
    const S = POWERS.shunt;
    const target = e.target && players.get(e.target);
    if (e.target && !target?.alive) e.target = null;
    if (e.target) {
      const c = chestOf(target.mover);
      const here = [e.x, e.y, e.z];
      if (clearLine(here, c, map.boxes)) e.blind = 0;
      else if (++e.blind > SHUNT_BLIND) e.target = null;
      if (e.target) turnToward(e.dir, c[0] - e.x, c[1] - e.y, c[2] - e.z, SHUNT_TURN);
    }
    let t = SHUNT_STEP;
    const from = [e.x, e.y, e.z];
    for (const b of map.boxes) t = Math.min(t, rayBox(from, e.dir, b.min, b.max));
    const go = t < SHUNT_STEP ? Math.max(0, t - BACKOFF) : t;
    e.x += e.dir[0] * go;
    e.y += e.dir[1] * go;
    e.z += e.dir[2] * go;
    // One entry per tick: the position the snapshot shows (launched this
    // tick, the launch entry is replaced).
    if (e.hist.at(-1)[0] === tick) e.hist.pop();
    e.hist.push([tick, e.x, e.y, e.z]);
    const at = [e.x, e.y, e.z];
    for (const q of players.values()) {
      if (q === e.by || !q.alive || boxDist(at, q.mover) > S.proximity) continue;
      // Direct hit: full damage and a shove along the flight.
      const h = Math.hypot(e.dir[0], e.dir[2]) || 1;
      this.queue.push({ by: e.by, q, dmg: S.direct, w: 'shunt', kx: (e.dir[0] / h) * S.knock, kz: (e.dir[2] / h) * S.knock, lift: S.lift, sx: e.x, sz: e.z });
      return this.explodeShunt(e, q);
    }
    if (t < SHUNT_STEP || tick >= e.dieAt) this.explodeShunt(e, null);
  }

  explodeShunt(e, direct) {
    const S = POWERS.shunt;
    const at = [e.x, e.y, e.z];
    e.gone = true;
    this.boom('shunt', at, S.splash, e.by, e.eid);
    this.splash(e.by, 'shunt', at, S.splash, S.splashMax, S.splashMin, S.knock / 2, S.lift / 2, direct);
  }

  // Where a Shunt was at fractional tick rt (null if not yet launched).
  // rt comes from the client: like the guns' history, it reaches back at
  // most HISTORY_TICKS.
  rewind(e, rt) {
    const { hist } = e;
    const first = hist[0][0];
    const { tick } = this.game;
    if (Number.isFinite(rt)) rt = Math.min(tick, Math.max(tick - HISTORY_TICKS, rt));
    if (!(rt >= first)) return Number.isFinite(rt) ? null : hist.at(-1).slice(1);
    const i = Math.min(hist.length - 1, Math.floor(rt - first));
    const a = hist[i];
    const b = hist[Math.min(hist.length - 1, i + 1)];
    const f = Math.min(1, Math.max(0, rt - a[0]));
    return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  }

  stepMine(e) {
    const { tick, players } = this.game;
    const M = POWERS.mine;
    if (tick >= e.dieAt) return this.fizzle(e, e.by);
    if (e.fuseAt) {
      if (tick >= e.fuseAt) this.detonateMine(e, e.by);
      return;
    }
    if (tick < e.armAt) return;
    for (const q of players.values()) {
      if (q === e.by || !q.alive || tick < q.protectedUntil) continue;
      const m = q.mover;
      if (Math.hypot(m.x - e.x, m.z - e.z) <= M.trigger && Math.abs(m.y - e.y) < 1.5) {
        e.fuseAt = tick + ticks(M.fuse);
        return;
      }
    }
  }

  detonateMine(e, by) {
    const M = POWERS.mine;
    const at = [e.x, e.y + M.box[1] / 2, e.z];
    e.gone = true;
    this.boom('mine', at, M.radius, by, e.eid);
    this.splash(by, 'mine', at, M.radius, M.dmgMax, M.dmgMin, M.knock, M.lift, null);
  }

  strike(e) {
    const { players } = this.game;
    const S = POWERS.shock;
    e.gone = true;
    this.boom('shock', [e.x, e.y, e.z], S.radius, e.by, e.eid);
    for (const q of players.values()) {
      if (q === e.by || !q.alive || e.cast.has(q.id)) continue;
      const m = q.mover;
      const dy = m.y - e.y;
      if (Math.hypot(m.x - e.x, m.z - e.z) > S.radius || dy < SHOCK_REACH[0] || dy > SHOCK_REACH[1]) continue;
      e.cast.add(q.id);
      this.queue.push({ by: e.by, q, dmg: S.dmg, w: 'shock', slow: true, sx: e.x, sz: e.z });
    }
  }

  // ---- Shared bits ----

  // Splash from `at`: everyone in sight within r except the owner and the
  // direct victim, damage and push falling off with distance.
  splash(by, w, at, r, max, min, push, lift, except) {
    const { players, map } = this.game;
    for (const q of players.values()) {
      if (q === by || q === except || !q.alive) continue;
      const m = q.mover;
      const d = boxDist(at, m);
      if (d >= r || !clearLine(at, chestOf(m), map.boxes)) continue;
      const f = pushScale(d, r);
      const hx = m.x - at[0];
      const hz = m.z - at[2];
      const h = Math.hypot(hx, hz);
      this.queue.push({
        by, q, dmg: Math.round(falloff(d, r, max, min)), w, kx: h ? (hx / h) * push * f : 0, kz: h ? (hz / h) * push * f : 0, lift: lift * f, sx: at[0], sz: at[2],
      });
    }
  }

  fizzle(e, by) {
    e.gone = true;
    this.boom(e.type === ENT.SHUNT ? 'shunt' : 'mine', [e.x, e.y, e.z], 0, by, e.eid);
  }

  boom(k, at, r, by, eid) {
    const { game } = this;
    game.broadcast({ t: 'event', e: 'boom', k, x: r2(at[0]), y: r2(at[1]), z: r2(at[2]), r, id: by.id, eid, tick: game.tick });
  }

  // One queued hit. A Shield up when it lands, or spawn protection, stops
  // the push and the slow; damage() handles the rest.
  apply(h) {
    const { q } = h;
    if (!q.alive || q === h.by) return;
    const guarded = q.pw.shield > 0 || this.game.tick < q.protectedUntil;
    this.game.damage(h.by, q, h.dmg, false, h.w, h.sx, h.sz);
    if (guarded || !q.alive) return;
    if (h.kx || h.kz || h.lift) knock(q.mover, h.kx, h.kz, h.lift);
    if (h.slow) {
      q.mover.slow = ticks(POWERS.shock.slowSeconds);
      q.mover.boost = 0;
    }
  }
}

// Rotate unit vector d toward (x, y, z) by at most `max` radians.
function turnToward(d, x, y, z, max) {
  const len = Math.hypot(x, y, z);
  if (!len) return;
  const w = [x / len, y / len, z / len];
  const cos = Math.max(-1, Math.min(1, d[0] * w[0] + d[1] * w[1] + d[2] * w[2]));
  if (Math.acos(cos) <= max) {
    d[0] = w[0];
    d[1] = w[1];
    d[2] = w[2];
    return;
  }
  // The part of w perpendicular to d (about the vertical when w is behind).
  let p = [w[0] - d[0] * cos, w[1] - d[1] * cos, w[2] - d[2] * cos];
  let pl = Math.hypot(...p);
  if (pl < 1e-9) {
    p = [-d[2], 0, d[0]];
    pl = Math.hypot(...p) || 1;
  }
  const c = Math.cos(max);
  const s = Math.sin(max);
  for (let i = 0; i < 3; i++) d[i] = d[i] * c + (p[i] / pl) * s;
}
