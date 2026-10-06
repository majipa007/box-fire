// Power-ups, the server side: the pads and their pickups, the projectiles
// in flight (Shunt, Bolt), the mines lying in wait, and what each power-up
// does when used. The shared slot step (shared/powerups.js) decides what is
// used and when; Game calls use() for it, step() once per tick, absorb()
// inside damage() and snapshot() for the wire.
import {
  TICK_RATE, DT, GRAVITY, MAX_HP, POWERUPS, POWERUP_SLOTS, PROJECTILE_RADIUS, PLAYER_WIDTH, STAND_HEIGHT, CROUCH_HEIGHT,
} from '../shared/constants.js';
import { padsFor, onPad, knock } from '../shared/powerups.js';
import { eyeOf, aimDir } from '../shared/weapons.js';
import { rayBox, sweep } from '../shared/collision.js';
import { entityTuple } from '../shared/protocol.js';

// Dev aid: `POWERUP_KIT=shunt,bolt,mine npm start` hands every new life
// these, to try the effects without running to the pads.
const KIT = (process.env.POWERUP_KIT ?? '').split(',').filter((k) => k in POWERUPS).slice(0, POWERUP_SLOTS);
const ATTACKS = new Set(['shunt', 'bolt', 'barge', 'mine']); // using one ends spawn protection, like firing
const MINE_HALF = 0.15; // m: a mine's box, for landing on whatever is below it
const MINE_HEIGHT = 0.1;
const MINE_REACH = [-1, 1.5]; // m: feet this far below or above a mine can set it off
const BACKOFF = 0.1; // m: a projectile bursts this far short of what it hit, so the blast has a clear view
const r2 = (v) => Math.round(v * 100) / 100;
const ticks = (seconds) => Math.round(seconds * TICK_RATE);
const heightOf = (m) => (m.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
const chest = (m) => [m.x, m.y + heightOf(m) / 2, m.z];

// The box a player fills, grown by `pad` m on every side: [min, max].
function body(m, pad) {
  const r = PLAYER_WIDTH / 2 + pad;
  return [[m.x - r, m.y - pad, m.z - r], [m.x + r, m.y + heightOf(m) + pad, m.z + r]];
}

export class Powerups {
  ents = []; // { id, kind, by, owner, x, y, z, vx, vy, vz, target, armed, armAt, dieAt, grounded }
  bursts = []; // Bolt volleys still firing: { by, left, nextAt }
  nextId = 1;

  constructor(game, mapId) {
    this.game = game;
    this.pads = padsFor(mapId).map(([x, y, z, kind]) => ({ x, y, z, kind, readyAt: 0 }));
  }

  // A new match: every pad full, nothing in flight.
  reset() {
    this.ents = [];
    this.bursts = [];
    for (const pad of this.pads) pad.readyAt = 0;
  }

  // A new life: empty slots (or the dev kit), no shield.
  spawned(p) {
    p.inv = [...KIT];
    p.shield = 0;
  }

  // p's slot step has just used `kind`, on this input.
  use(p, kind, input) {
    const def = POWERUPS[kind];
    const { tick } = this.game;
    const m = p.mover;
    if (ATTACKS.has(kind)) p.protectedUntil = 0;
    this.game.broadcast({ t: 'event', e: 'powerup', id: p.id, k: kind, x: r2(m.x), y: r2(m.y), z: r2(m.z) });
    if (kind === 'shield') {
      p.shield = def.hp;
      p.shieldUntil = tick + ticks(def.seconds);
    } else if (kind === 'repair') {
      p.hp = Math.min(MAX_HP, p.hp + def.hp);
    } else if (kind === 'shunt') {
      this.launch(p, kind, input.yaw, input.pitch);
    } else if (kind === 'bolt') {
      this.bursts.push({ by: p, left: def.count, nextAt: tick });
    } else if (kind === 'barge') {
      this.blast(p, kind, chest(m), null, null);
    } else if (kind === 'mine') {
      const mines = this.ents.filter((e) => e.by === p && e.kind === 'mine');
      if (mines.length >= def.max) this.ents.splice(this.ents.indexOf(mines[0]), 1); // the oldest goes
      this.ents.push({ id: this.nextId++, kind, by: p, owner: p.id, x: m.x, y: m.y, z: m.z, vx: 0, vy: 0, vz: 0, armed: false, grounded: false, armAt: tick + ticks(def.arm), dieAt: tick + ticks(def.life) });
    }
  }

  // A Shunt or a Bolt from p's eye along (yaw, pitch).
  launch(p, kind, yaw, pitch) {
    const def = POWERUPS[kind];
    const [x, y, z] = eyeOf(p.mover);
    const d = aimDir(yaw, pitch);
    this.ents.push({
      id: this.nextId++, kind, by: p, owner: p.id, x, y, z, vx: d[0] * def.speed, vy: d[1] * def.speed, vz: d[2] * def.speed,
      target: kind === 'shunt' ? this.acquire(p, [x, y, z], d, def.cone) : null, armed: false, dieAt: this.game.tick + ticks(def.life),
    });
  }

  // The enemy in sight nearest the heading `dir` from `from`, within `cone` degrees.
  acquire(by, from, dir, cone) {
    let best = null;
    let bestCos = Math.cos((cone * Math.PI) / 180);
    for (const q of this.game.players.values()) {
      if (q === by || !q.alive || this.game.tick < q.protectedUntil) continue;
      const c = chest(q.mover);
      const cos = ((c[0] - from[0]) * dir[0] + (c[1] - from[1]) * dir[1] + (c[2] - from[2]) * dir[2]) / Math.hypot(c[0] - from[0], c[1] - from[1], c[2] - from[2]);
      if (cos > bestCos && this.clear(from, c)) {
        best = q;
        bestCos = cos;
      }
    }
    return best;
  }

  // Is the straight line from a to b free of map boxes?
  clear(a, b) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (!len) return true;
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
    return this.game.map.boxes.every((box) => rayBox(a, dir, box.min, box.max) >= len);
  }

  // Once per tick, after every player has moved.
  step() {
    const { tick, players } = this.game;
    // The first player through a ready pad with a free slot takes it.
    this.pads.forEach((pad, i) => {
      if (tick < pad.readyAt) return;
      for (const p of players.values()) {
        if (!p.alive || p.inv.length >= POWERUP_SLOTS || !onPad(p.mover, pad.x, pad.y, pad.z)) continue;
        p.inv.push(pad.kind);
        pad.readyAt = tick + ticks(POWERUPS[pad.kind].respawn);
        this.game.broadcast({ t: 'event', e: 'pickup', id: p.id, pad: i, k: pad.kind });
        return;
      }
    });
    for (const p of players.values()) if (p.shield > 0 && tick >= p.shieldUntil) p.shield = 0;
    this.bursts = this.bursts.filter((b) => {
      if (!b.by.alive) return false;
      if (tick < b.nextAt) return true;
      this.launch(b.by, 'bolt', b.by.yaw, b.by.pitch);
      b.nextAt = tick + ticks(POWERUPS.bolt.gap);
      return --b.left > 0;
    });
    this.ents = this.ents.filter((e) => (e.kind === 'mine' ? this.stepMine(e) : this.stepProjectile(e)));
  }

  // Homing: a Shunt turns toward its target's chest at most `turn` rad/s,
  // and looks for a new target along its heading whenever it has none.
  steer(e, def) {
    const h = [e.vx / def.speed, e.vy / def.speed, e.vz / def.speed];
    if (!e.target?.alive) e.target = this.acquire(e.by, [e.x, e.y, e.z], h, def.cone);
    if (!e.target) return;
    const c = chest(e.target.mover);
    const len = Math.hypot(c[0] - e.x, c[1] - e.y, c[2] - e.z);
    if (!len) return;
    const w = [(c[0] - e.x) / len, (c[1] - e.y) / len, (c[2] - e.z) / len];
    const cos = Math.max(-1, Math.min(1, h[0] * w[0] + h[1] * w[1] + h[2] * w[2]));
    const max = def.turn * DT;
    let d = w;
    if (Math.acos(cos) > max) {
      // Rotate h toward w by `max`, in the plane they span (about the
      // vertical when w is straight behind).
      let p = [w[0] - h[0] * cos, w[1] - h[1] * cos, w[2] - h[2] * cos];
      if (Math.hypot(...p) < 1e-9) p = [-h[2], 0, h[0]];
      const pl = Math.hypot(...p) || 1;
      d = h.map((v, i) => v * Math.cos(max) + (p[i] / pl) * Math.sin(max));
    }
    e.vx = d[0] * def.speed;
    e.vy = d[1] * def.speed;
    e.vz = d[2] * def.speed;
  }

  // One step of flight: the nearest wall or enemy along it stops it.
  // Returns false once it has burst.
  stepProjectile(e) {
    const def = POWERUPS[e.kind];
    if (e.kind === 'shunt') this.steer(e, def);
    const from = [e.x, e.y, e.z];
    const dir = [e.vx / def.speed, e.vy / def.speed, e.vz / def.speed];
    const reach = def.speed * DT;
    let t = reach;
    for (const b of this.game.map.boxes) t = Math.min(t, rayBox(from, dir, b.min, b.max));
    let victim = null;
    for (const q of this.game.players.values()) {
      if (q === e.by || !q.alive) continue;
      const [lo, hi] = body(q.mover, PROJECTILE_RADIUS);
      const d = rayBox(from, dir, lo, hi);
      if (d <= t) {
        t = d;
        victim = q;
      }
    }
    const back = t < reach ? Math.min(t, BACKOFF) : 0;
    e.x += dir[0] * (t - back);
    e.y += dir[1] * (t - back);
    e.z += dir[2] * (t - back);
    if (t < reach || victim || this.game.tick >= e.dieAt) {
      this.blast(e.by, e.kind, [e.x, e.y, e.z], victim, dir);
      return false;
    }
    return true;
  }

  // A mine falls until it lands, arms, then waits for an enemy to come
  // close. Returns false once it has gone off or expired.
  stepMine(e) {
    const { tick } = this.game;
    if (tick >= e.dieAt) return false;
    if (!e.grounded) {
      const dy = e.vy * DT - 0.5 * GRAVITY * DT * DT;
      e.vy -= GRAVITY * DT;
      const moved = sweep(e, MINE_HALF, MINE_HEIGHT, 1, dy, this.game.map.boxes);
      e.y += moved;
      if (moved !== dy) {
        e.vy = 0;
        e.grounded = true;
      }
    }
    if (!e.armed && tick >= e.armAt) e.armed = true;
    if (!e.armed) return true;
    const def = POWERUPS.mine;
    for (const q of this.game.players.values()) {
      if (q === e.by || !q.alive || tick < q.protectedUntil) continue;
      const m = q.mover;
      if (Math.hypot(m.x - e.x, m.z - e.z) <= def.trigger && m.y >= e.y + MINE_REACH[0] && m.y <= e.y + MINE_REACH[1]) {
        this.blast(e.by, 'mine', [e.x, e.y + 0.3, e.z], null, null);
        return false;
      }
    }
    return true;
  }

  // A burst at `at`: the direct victim (if any) takes `dmg` and is pushed
  // along `dir`; every other enemy in sight within `radius` takes splash
  // and is pushed away, both falling off with distance. Never the owner.
  blast(by, kind, at, direct, dir) {
    const def = POWERUPS[kind];
    const { tick } = this.game;
    this.game.broadcast({ t: 'event', e: 'blast', k: kind, x: r2(at[0]), y: r2(at[1]), z: r2(at[2]) });
    for (const q of this.game.players.values()) {
      if (q === by || !q.alive || tick < q.protectedUntil) continue;
      const m = q.mover;
      let f = 1;
      let dmg = def.dmg;
      let dx = dir?.[0];
      let dz = dir?.[2];
      if (q !== direct) {
        if (!def.radius) continue;
        const [lo, hi] = body(m, 0);
        const d = Math.hypot(...at.map((v, a) => v - Math.max(lo[a], Math.min(hi[a], v))));
        if (d >= def.radius || !this.clear(at, chest(m))) continue;
        f = 1 - d / def.radius;
        dmg = Math.round(def.splash * f);
        dx = m.x - at[0];
        dz = m.z - at[2];
      }
      knock(m, dx, dz, def.knock * f, def.lift * f);
      if (dmg > 0) this.game.damage(by, q, dmg, false, kind);
    }
  }

  // A Shield soaks damage before it reaches HP; returns what gets through.
  absorb(victim, dmg) {
    const soak = Math.min(victim.shield, dmg);
    victim.shield -= soak;
    return dmg - soak;
  }

  // The `pu` part of a snapshot, as JSON: pads (0 when ready, else the tick
  // each refills) and the entities.
  snapshot() {
    const { tick } = this.game;
    return JSON.stringify({ pads: this.pads.map((p) => (tick < p.readyAt ? p.readyAt : 0)), ents: this.ents.map(entityTuple) });
  }
}
