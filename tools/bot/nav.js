// Bot navigation: a 0.5 m height grid built from a map's boxes, A* over it,
// and a route follower that replans and hops when stuck. Pure apart from
// loading listed map files; no sockets, no clocks.
import { readFileSync } from 'node:fs';
import { prepareMap } from '../../shared/collision.js';
import { PLAYER_WIDTH, MAPS } from '../../shared/constants.js';

const CELL = 0.5;
const STEP_MAX = 0.9; // step() climbs 0.99 m with a jump and fails at 1.00 m
// A centre this close to a box is on it or against it. The 5 cm skin keeps
// routes off corners a walker would snag on (one arena_02 trip deadlocks
// against a box without it).
const R = PLAYER_WIDTH / 2 + 0.05;
const MAX_EXPANSIONS = 3000; // past this, walk straight and replan later
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// Each cell holds the top of the highest (inflated) box over its centre.
function buildGrid(boxes) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.min[0]); z0 = Math.min(z0, b.min[2]); x1 = Math.max(x1, b.max[0]); z1 = Math.max(z1, b.max[2]); }
  const w = Math.ceil((x1 - x0) / CELL), d = Math.ceil((z1 - z0) / CELL), n = w * d;
  const h = new Float32Array(n).fill(-Infinity);
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    const cx = x0 + (i + 0.5) * CELL, cz = z0 + (j + 0.5) * CELL;
    for (const b of boxes) {
      if (cx > b.min[0] - R && cx < b.max[0] + R && cz > b.min[2] - R && cz < b.max[2] + R) h[j * w + i] = Math.max(h[j * w + i], b.max[1]);
    }
  }
  // A* buffers, reused across plans by generation stamps: no garbage per plan.
  return { x0, z0, w, d, h, gs: new Float64Array(n), came: new Int32Array(n), stamp: new Int32Array(n), gen: 0, hk: new Float64Array(8 * n + 1), hv: new Int32Array(8 * n + 1) };
}

const cellOf = (g, x, z) => {
  const i = Math.floor((x - g.x0) / CELL), j = Math.floor((z - g.z0) / CELL);
  return i < 0 || j < 0 || i >= g.w || j >= g.d ? -1 : j * g.w + i;
};
const cx = (g, c) => g.x0 + ((c % g.w) + 0.5) * CELL;
const cz = (g, c) => g.z0 + (Math.floor(c / g.w) + 0.5) * CELL;

// Every 0.25 m along the segment, no cell rises more than a step above the last.
function lineWalkable(g, x, y, z, tx, tz) {
  const n = Math.ceil(Math.hypot(tx - x, tz - z) / 0.25);
  let h = y;
  for (let s = 1; s <= n; s++) {
    const c = cellOf(g, x + ((tx - x) * s) / n, z + ((tz - z) * s) / n);
    if (c < 0 || g.h[c] - h > STEP_MAX) return false;
    h = g.h[c];
  }
  return true;
}

// A* from (x, gy, z) to the goal cell: 8-connected, no corner cutting, up at
// most STEP_MAX, any drop. Returns the cells start → goal, [goal] when the
// search is capped (walk straight), or null when the goal is unreachable.
function path(g, x, gy, z, goal) {
  const h = g.h, w = g.w, start = cellOf(g, x, z);
  if (start < 0 || goal < 0) return null;
  const gen = ++g.gen, { gs, came, stamp, hk, hv } = g;
  const gi = goal % w, gj = (goal - gi) / w;
  const heur = (c) => { const dx = Math.abs((c % w) - gi), dz = Math.abs(Math.floor(c / w) - gj); return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * CELL; };
  let len = 0, expanded = 0;
  const push = (k, v) => { let i = len++; while (i) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
  stamp[start] = gen; gs[start] = 0; came[start] = -1;
  push(heur(start), start);
  while (len) {
    const u = hv[0], fu = hk[0];
    const lk = hk[--len], lv = hv[len];
    let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= len) break; if (c + 1 < len && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; }
    hk[i] = lk; hv[i] = lv;
    if (fu - heur(u) > gs[u] + 1e-9) continue; // stale entry
    if (u === goal) {
      const out = [];
      for (let c = goal; c !== -1; c = came[c]) out.push(c);
      return out.reverse();
    }
    if (++expanded > MAX_EXPANSIONS) return [goal];
    const hu = u === start ? Math.min(h[u], gy) : h[u]; // feet height at the start: brushing a wall is not standing on it
    const ui = u % w, uj = (u - ui) / w;
    for (let k = 0; k < 8; k++) {
      const di = N8[k][0], dj = N8[k][1], vi = ui + di, vj = uj + dj;
      if (vi < 0 || vj < 0 || vi >= w || vj >= g.d) continue;
      const v = vj * w + vi;
      if (h[v] - hu > STEP_MAX) continue;
      if (di && dj && (h[uj * w + vi] - hu > STEP_MAX || h[vj * w + ui] - hu > STEP_MAX)) continue;
      const nd = gs[u] + N8[k][2] * CELL;
      if (stamp[v] !== gen || nd < gs[v]) { stamp[v] = gen; gs[v] = nd; came[v] = u; push(nd + heur(v), v); }
    }
  }
  return null;
}

// Where along the route to steer: the furthest of the next 12 cells in a
// straight walkable line, whether the next 1.5 m climbs (jump), how far off
// the route the walker is, and how much route is left. Written into r.
function along(g, r, x, gy, z) {
  const cells = r.cells;
  let at = 0, bd = Infinity;
  for (let k = 0, n = Math.min(cells.length, 40); k < n; k++) { const d = Math.hypot(cx(g, cells[k]) - x, cz(g, cells[k]) - z); if (d < bd) { bd = d; at = k; } }
  let to = cells[Math.min(at + 1, cells.length - 1)];
  for (let k = Math.min(cells.length - 1, at + 12); k > at + 1; k--) if (lineWalkable(g, x, gy, z, cx(g, cells[k]), cz(g, cells[k]))) { to = cells[k]; break; }
  r.ajump = false;
  for (let k = at + 1; k < Math.min(cells.length, at + 4); k++) if (g.h[cells[k]] - gy > 0.25) r.ajump = true;
  r.ax = cx(g, to); r.az = cz(g, to); r.aoff = bd; r.aleft = (cells.length - 1 - at) * CELL;
}

// The floor height at (x, z) when a walker at (x0, y0, z0) can walk straight
// there, else null.
export function floorReachable(nav, x0, y0, z0, x, z) {
  const g = nav.g, c = cellOf(g, x, z);
  return c >= 0 && g.h[c] - y0 <= STEP_MAX && lineWalkable(g, x0, y0, z0, x, z) ? g.h[c] : null;
}

// One nav per listed map id, built on first use. Anything not in MAPS is
// refused before it could become a file path.
const navs = new Map();
export function navFor(id) {
  if (!MAPS.includes(id)) return null;
  if (!navs.has(id)) {
    const map = prepareMap(JSON.parse(readFileSync(new URL(`../../shared/maps/${id}.json`, import.meta.url))));
    navs.set(id, { id, map, g: buildGrid(map.boxes) });
  }
  return navs.get(id);
}

// A goal against a wall sits in a cell the inflation raised to the wall's
// top: plan to the nearest cell within 1 m at the goal's own height instead.
// A goal off the grid (a noisy heard shot) is first pulled 1 m inside its
// edge, which on every listed map is the outer wall's inner face.
function floorCell(g, x, y, z) {
  x = Math.min(Math.max(x, g.x0 + 1), g.x0 + g.w * CELL - 1);
  z = Math.min(Math.max(z, g.z0 + 1), g.z0 + g.d * CELL - 1);
  const c = cellOf(g, x, z);
  if (c < 0 || g.h[c] <= y + 0.3) return c;
  let best = c, bd = Infinity;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const v = cellOf(g, x + di * CELL, z + dj * CELL);
    if (v >= 0 && Math.abs(g.h[v] - y) <= 0.3 && di * di + dj * dj < bd) { best = v; bd = di * di + dj * dj; }
  }
  return best;
}

// A walker's route state. Clear it (make a new one) on a map change.
export const createRoute = () => ({ cells: null, goal: -1, gx: 0, gz: 0, at: -1e9, fail: -1e9, gy: null, lx: NaN, lz: NaN, stuck: 0, ax: 0, az: 0, ajump: false, aoff: 0, aleft: 0, out: { x: 0, z: 0, jump: false, left: 0, stuck: 0 } });

// One tick of walking toward `goal` ([x, y, z]); call it only while holding
// move keys. Returns { x, z, jump, left, stuck } (steer toward x, z) or null
// when the goal is unreachable or the walker has been stuck for 1 s.
// Follows an A* route, replanned when the goal moves 1.5 m, every 0.5 s, or
// 1.5 m off it, at most budget.plans times per tick across every bot (the
// caller resets it). A goal found unreachable is not retried for 0.5 s.
export function follow(nav, r, m, goal, tick, budget) {
  const g = nav.g, out = r.out;
  if (m.grounded || r.gy === null) r.gy = m.y;
  r.stuck = Math.hypot(m.x - r.lx, m.z - r.lz) < 0.02 ? r.stuck + 1 : 0;
  r.lx = m.x; r.lz = m.z;
  if (r.stuck > 60) { r.stuck = 0; r.cells = null; return null; }
  out.x = goal[0]; out.z = goal[2]; out.jump = r.stuck > 4; out.stuck = r.stuck;
  out.left = Math.hypot(goal[0] - m.x, goal[2] - m.z);
  const near = Math.hypot(goal[0] - r.gx, goal[2] - r.gz) < 1.5;
  if (out.left < 0.75) return out; // there: nothing to plan
  if (near && tick - r.fail < 30) return null; // just found unreachable
  const keep = r.cells && near;
  if (keep) along(g, r, m.x, r.gy, m.z);
  if ((!keep || tick - r.at > 30 || r.aoff > 1.5) && budget.plans > 0) {
    budget.plans--;
    r.goal = floorCell(g, goal[0], goal[1], goal[2]); r.gx = goal[0]; r.gz = goal[2]; r.at = tick;
    r.cells = path(g, m.x, r.gy, m.z, r.goal);
    if (!r.cells) { r.fail = tick; return null; }
    along(g, r, m.x, r.gy, m.z);
  } else if (!keep) return out; // waiting for a plan slot: walk straight meanwhile
  if (r.aleft >= 1) { out.x = r.ax; out.z = r.az; out.left = r.aleft; out.jump ||= r.ajump; }
  return out;
}
