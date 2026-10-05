// The last second of hitbox positions, so a shot can be tested against the
// world its shooter was looking at (rewind), not the one the server has now.
import { HISTORY_TICKS } from '../shared/constants.js';

const SIZE = HISTORY_TICKS + 1;

export class History {
  ring = new Array(SIZE).fill(null); // { tick, players: Map id → { x, y, z, crouch } }
  newest = -Infinity;

  // entries: [id, { x, y, z, crouch }] for every living player at this tick.
  record(tick, entries) {
    this.ring[tick % SIZE] = { tick, players: new Map(entries) };
    this.newest = tick;
  }

  frame(tick) {
    const f = this.ring[((tick % SIZE) + SIZE) % SIZE];
    return f && f.tick === tick ? f.players : null;
  }

  // Targets ({ id, x, y, z, crouch }) at fractional tick rt, blended between
  // the stored ticks around it. rt comes from the client, so it is clamped to
  // the stored second and can never read outside the buffer.
  at(rt, now) {
    const hi = Math.min(now, this.newest);
    const t = Number.isFinite(rt) ? Math.min(hi, Math.max(now - HISTORY_TICKS, rt)) : hi;
    const t0 = Math.floor(t);
    const a = t - t0;
    const f0 = this.frame(t0) ?? this.frame(hi);
    const f1 = this.frame(Math.min(t0 + 1, hi)) ?? f0;
    if (!f0) return [];
    const out = [];
    for (const id of new Set([...f0.keys(), ...f1.keys()])) {
      const p = f0.get(id);
      const q = f1.get(id);
      const near = a < 0.5 ? p : q;
      // Not alive at both ticks, or respawned between them: use the nearer tick.
      if (!p || !q || Math.hypot(q.x - p.x, q.z - p.z) > 2) {
        if (near) out.push({ id, ...near });
        continue;
      }
      out.push({ id, x: p.x + (q.x - p.x) * a, y: p.y + (q.y - p.y) * a, z: p.z + (q.z - p.z) * a, crouch: near.crouch });
    }
    return out;
  }
}
