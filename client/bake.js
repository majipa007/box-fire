// Static-world baking with no three.js and no DOM, so Node can test it.
// world.js turns the arrays and quads made here into meshes.
const q = (v) => Math.round(v * 1e4) / 1e4; // 0.1 mm grid: equal box edges compare equal
const TANGENTS = [[2, 1], [0, 2], [0, 1]]; // [u, v] axes per normal axis; v is up on side faces
const CROSS = [-1, -1, 1]; // sign of u × v along the normal axis, for the winding
const NUDGE = 1e-3; // m: probes start this far in front of a face
const NO_EDGE = 100; // m added to a face-local coordinate to switch that edge's darkening off

// Map boxes → { meshes: { [material]: arrays }, triangles }. A box is
// { pos, size, mat, top?, vTop?, tile? }: `top` names the material of its top
// face, `vTop` pins the top face's v (metres, e.g. into a wall texture's coping
// band) and `tile` switches to face-local UVs, one texture repeat per whole
// `tile` metres of face (crates).
// Arrays per material: position, normal, uv (world metres unless `tile`), ao
// (0–1), along (where sand drifts, on the ground and the sides of boxes standing
// on it: the distances in m along the face's u and v axes to the boxes standing on
// the face, each up to `radius`, so an inside corner reads as both small; −1, −1
// elsewhere), crease (m, up to `radius`: distance to the nearest other box, so the shader can
// draw a contact band of any width on the coarse grid: a distance to a straight
// edge interpolates exactly), sun (1 where the sun reaches, for when there is no
// shadow map), face (face-local u, v, width, height in metres, for edge
// treatment) and index.
// - Faces are cut on one global grid per axis: every box edge, filled to
//   `cell` metres. Touching faces therefore share vertices (no T-junction
//   cracks), and every contact line gets its own row of vertices, so the AO
//   crease is crisp.
// - Hidden faces: cells inside another box and faces under the floor are
//   dropped. Faces looking out of the map footprint (seen only from the lobby
//   camera) are kept as one row of cells with no AO.
// - AO: each vertex casts `rays` cosine-weighted rays up to `radius` m;
//   AO = 1 − strength × mean(1 − hit / radius). Each quad is split along its
//   brighter diagonal (0fps), so occlusion never streaks.
// - Edges that run into another box are creases, and get no edge treatment.
export function meshMap(mapBoxes, { cell, rays, radius, strength, sunDir = [0, 1, 0] }) {
  const boxes = mapBoxes.map(({ pos, size, mat, top, vTop, tile }) => ({
    min: pos.map((p, i) => q(p - size[i] / 2)),
    max: pos.map((p, i) => q(p + size[i] / 2)),
    mat,
    top: top ?? mat,
    vTop,
    tile,
  }));
  const lines = [0, 1, 2].map((a) => gridLines(boxes, a, cell));
  const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
  const floor = Math.min(...boxes.map((b) => b.max[1])); // the lowest top: nothing is seen from below it
  // Rays test slightly shrunk boxes, so a probe on a contact line only counts the box it faces.
  const solid = boxes.map((b) => ({ min: b.min.map((v) => v + 1e-4), max: b.max.map((v) => v - 1e-4) }));
  // Indexed loops in the hot paths: the bake runs once, before V8 optimises anything, and
  // for-of allocates an iterator result per step in unoptimised code.
  const solidAt = (p, list = boxes) => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.min[0] < p[0] && p[0] < b.max[0] && b.min[1] < p[1] && p[1] < b.max[1] && b.min[2] < p[2] && p[2] < b.max[2]) return true;
    }
    return false;
  };
  const fans = [0, 1, 2].map((a) => ({ [-1]: hemisphere(a, -1, rays), 1: hemisphere(a, 1, rays) }));
  const origin = [0, 0, 0];
  const local = [];
  let nearest = radius; // set by occlusion(): distance from its probe to the nearest box
  const probe = [0, 0, 0];
  // Is the quadrant beside face point p, toward (su, sv) along (u, v), open air? Below the
  // floor counts as solid: nothing is ever seen there.
  const open = (p, a, s, u, v, su, sv, list) => {
    probe[a] = p[a] + s * NUDGE;
    probe[u] = p[u] + su * NUDGE;
    probe[v] = p[v] + sv * NUDGE;
    return probe[1] > floor && !solidAt(probe, list);
  };
  // Distances along u and along v from face point p to the boxes standing on the face (they
  // cross its front plane), counting a box only straight across one axis. A box touched at
  // its corner counts across the axis whose quadrant beyond it is open air, so the inside
  // corner of two boxes gets both distances 0, and a lone box's outside corner neither.
  const along = (p, a, s, u, v, list, covering) => {
    let du = radius;
    let dv = radius;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const gu = Math.max(c.min[u] - p[u], 0, p[u] - c.max[u]);
      const gv = Math.max(c.min[v] - p[v], 0, p[v] - c.max[v]);
      if (gv === 0 && gu > 0) du = Math.min(du, gu);
      else if (gu === 0 && gv > 0) dv = Math.min(dv, gv);
      else if (gu === 0 && gv === 0) {
        const su = p[u] === c.min[u] ? 1 : p[u] === c.max[u] ? -1 : 0; // toward the box, 0 inside its span
        const sv = p[v] === c.min[v] ? 1 : p[v] === c.max[v] ? -1 : 0;
        if (su && !sv) du = 0;
        else if (sv && !su) dv = 0;
        else if (su && sv) {
          const acrossU = open(p, a, s, u, v, -su, sv, covering);
          if (acrossU !== open(p, a, s, u, v, su, -sv, covering)) {
            if (acrossU) du = 0;
            else dv = 0;
          }
        }
      }
    }
    return [du, dv];
  };

  function occlusion(p, a, s, near) {
    origin[0] = p[0];
    origin[1] = p[1];
    origin[2] = p[2];
    origin[a] += s * NUDGE;
    local.length = 0;
    nearest = radius;
    for (let i = 0; i < near.length; i++) {
      const d = distance(origin, near[i]);
      if (d < radius) local.push(near[i]);
      if (d < nearest) nearest = d;
    }
    if (!local.length) return 1;
    const fan = fans[a][s];
    let occluded = 0;
    for (let k = 0; k < fan.length; k++) {
      let t = radius;
      for (let i = 0; i < local.length; i++) t = enter(origin, fan[k], local[i], t);
      occluded += 1 - t / radius;
    }
    return 1 - (strength * occluded) / rays;
  }
  // 1 if nothing in `blockers` stands between this face point and the sun.
  function sunlit(p, a, s, blockers) {
    if (s * sunDir[a] <= 0) return 0; // faces away: Lambert gives it no sun anyway
    origin[0] = p[0];
    origin[1] = p[1];
    origin[2] = p[2];
    origin[a] += s * NUDGE;
    for (let i = 0; i < blockers.length; i++) if (enter(origin, sunDir, blockers[i], Infinity) < Infinity) return 0;
    return 1;
  }

  const meshes = {};
  let triangles = 0;
  boxes.forEach((b, self) => {
    for (let a = 0; a < 3; a++) {
      const [u, v] = TANGENTS[a];
      for (const s of [-1, 1]) {
        const plane = s > 0 ? b.max[a] : b.min[a];
        if (a === 1 ? s < 0 && plane <= floor : b.max[1] <= floor) continue;
        const outer = a !== 1 && plane === (s > 0 ? hi[a] : lo[a]);
        const drifts = (a === 1 && s > 0 && plane === floor) || (a !== 1 && b.min[1] === floor); // sand: the ground and what stands on it
        const out = (meshes[a === 1 && s > 0 ? b.top : b.mat] ??= { position: [], normal: [], uv: [], ao: [], along: [], crease: [], sun: [], face: [], index: [] });
        const us = slice(lines[u], b.min[u], b.max[u]);
        const vs = outer ? [b.min[v], b.max[v]] : slice(lines[v], b.min[v], b.max[v]);
        const front = plane + s * NUDGE;
        const reach = { min: [...b.min], max: [...b.max] };
        reach.min[a] = s > 0 ? plane : plane - radius;
        reach.max[a] = s > 0 ? plane + radius : plane;
        for (const t of [u, v]) {
          reach.min[t] -= radius;
          reach.max[t] += radius;
        }
        const overlapping = (list, r) => list.filter((c) => c.min.every((m, k) => m < r.max[k] && c.max[k] > r.min[k]));
        const near = overlapping(solid.filter((c, i) => i !== self), reach);
        // Boxes that can cover a cell of this face (they reach its plane), and boxes that can
        // stand between it and the sun (inside the face swept toward the sun to the top).
        const flat = { min: [...b.min], max: [...b.max] };
        flat.min[a] = flat.max[a] = front;
        for (const t of [u, v]) {
          flat.min[t] -= 2 * NUDGE; // the crease probes sit just past the face's edges
          flat.max[t] += 2 * NUDGE;
        }
        const covering = boxes.filter((c) => c.min.every((m, k) => m <= flat.max[k] && c.max[k] >= flat.min[k]));
        const standing = drifts ? boxes.filter((c, i) => i !== self && c.min[a] < front && front < c.max[a] && c.min.every((m, k) => m < reach.max[k] && c.max[k] > reach.min[k])) : [];
        const lift = Math.max(0, (hi[1] - b.min[1]) / sunDir[1]);
        const swept = { min: flat.min.map((m, k) => Math.min(m, m + sunDir[k] * lift)), max: flat.max.map((m, k) => Math.max(m, m + sunDir[k] * lift)) };
        const blockers = sunDir[1] > 0 ? overlapping(solid, swept) : solid;
        // Per row of vertices along u, only the boxes within reach of that row: the floor
        // alone would otherwise test every box from each of its ~6k vertices.
        const du = sunDir[1] > 0 ? sunDir[u] * lift : 0;
        const nearRow = us.map((x) => near.filter((c) => c.min[u] - radius <= x && x <= c.max[u] + radius));
        const blockRow = us.map((x) => (sunDir[1] > 0 ? blockers.filter((c) => c.min[u] <= x + Math.max(0, du) && x + Math.min(0, du) <= c.max[u]) : blockers));
        const crease = (t, side) => {
          const o = t === u ? v : u;
          const p = [];
          p[a] = front;
          p[t] = side < 0 ? b.min[t] - NUDGE : b.max[t] + NUDGE;
          p[o] = (b.min[o] + b.max[o]) / 2;
          return solidAt(p, covering) ? NO_EDGE : 0;
        };
        const ku = crease(u, -1);
        const kv = crease(v, -1);
        const width = b.max[u] - b.min[u] + ku + crease(u, 1);
        const height = b.max[v] - b.min[v] + kv + crease(v, 1);
        const su = a === 0 ? -s : a === 2 ? s : 1; // world UVs, unmirrored seen from the front
        const sv = a === 1 ? -s : 1;
        // Face-local UVs: whole tiles across the face, measured from its left and bottom edges.
        const sizeU = b.max[u] - b.min[u];
        const sizeV = b.max[v] - b.min[v];
        const tilesU = b.tile && Math.max(1, Math.round(sizeU / b.tile));
        const tilesV = b.tile && Math.max(1, Math.round(sizeV / b.tile));
        const ids = new Int32Array(us.length * vs.length).fill(-1);
        const p = [0, 0, 0];
        const vertex = (i, j) => {
          const key = i * vs.length + j;
          let id = ids[key];
          if (id < 0) {
            id = out.ao.length;
            ids[key] = id;
            p[a] = plane;
            p[u] = us[i];
            p[v] = vs[j];
            out.position.push(p[0], p[1], p[2]);
            out.normal.push(a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0);
            if (b.tile) out.uv.push((((su > 0 ? p[u] - b.min[u] : b.max[u] - p[u]) / sizeU) * tilesU), (((sv > 0 ? p[v] - b.min[v] : b.max[v] - p[v]) / sizeV) * tilesV));
            else out.uv.push(su * p[u], a === 1 && s > 0 && b.vTop !== undefined ? b.vTop : sv * p[v]);
            out.face.push(p[u] - b.min[u] + ku, p[v] - b.min[v] + kv, width, height);
            const ao = outer ? 1 : occlusion(p, a, s, nearRow[i]);
            out.ao.push(ao);
            out.crease.push(outer ? radius : nearest);
            out.along.push(...(drifts && !outer ? along(p, a, s, u, v, standing, covering) : [-1, -1]));
            out.sun.push(outer ? 1 : sunlit(p, a, s, blockRow[i]));
          }
          return id;
        };
        const centre = [0, 0, 0];
        centre[a] = front;
        for (let i = 0; i + 1 < us.length; i++) {
          for (let j = 0; j + 1 < vs.length; j++) {
            centre[u] = (us[i] + us[i + 1]) / 2;
            centre[v] = (vs[j] + vs[j + 1]) / 2;
            if (solidAt(centre, covering)) continue; // hidden inside another box
            const v00 = vertex(i, j);
            const v10 = vertex(i + 1, j);
            const v11 = vertex(i + 1, j + 1);
            const v01 = vertex(i, j + 1);
            const { ao, index } = out;
            const flip = ao[v00] + ao[v11] >= ao[v10] + ao[v01];
            if (CROSS[a] * s > 0) {
              if (flip) index.push(v00, v10, v11, v00, v11, v01);
              else index.push(v00, v10, v01, v10, v11, v01);
            } else if (flip) index.push(v01, v11, v00, v11, v10, v00);
            else index.push(v01, v11, v10, v01, v10, v00);
            triangles += 2;
          }
        }
      }
    }
  });
  for (const m of Object.values(meshes)) {
    for (const k of ['position', 'normal', 'uv', 'ao', 'along', 'crease', 'sun', 'face']) m[k] = new Float32Array(m[k]);
    m.index = new Uint32Array(m.index);
  }
  return { meshes, triangles };
}

// rayBox from shared/collision.js, inlined for the bake's hot loop: the distance along the
// unit ray d from o to where it enters box b, or `far` when that is no nearer than `far`.
function enter(o, d, b, far) {
  let near = 0;
  let t = far;
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return far;
      continue;
    }
    let t1 = (b.min[a] - o[a]) / d[a];
    let t2 = (b.max[a] - o[a]) / d[a];
    if (t1 > t2) {
      const x = t1;
      t1 = t2;
      t2 = x;
    }
    if (t1 > near) near = t1;
    if (t2 < t) t = t2;
    if (near > t) return far;
  }
  return near;
}

// Every box edge along one axis, with gaps cut into equal steps of at most `cell`.
function gridLines(boxes, a, cell) {
  const edges = [...new Set(boxes.flatMap((b) => [b.min[a], b.max[a]]))].sort((x, y) => x - y);
  const lines = [edges[0]];
  for (let i = 1; i < edges.length; i++) {
    const gap = edges[i] - edges[i - 1];
    const n = Math.ceil(gap / cell - 1e-9);
    for (let k = 1; k < n; k++) lines.push(q(edges[i - 1] + (gap * k) / n));
    lines.push(edges[i]);
  }
  return lines;
}

const slice = (lines, from, to) => lines.slice(lines.indexOf(from), lines.indexOf(to) + 1);

function distance(p, b) {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const e = Math.max(b.min[i] - p[i], 0, p[i] - b.max[i]);
    d += e * e;
  }
  return Math.sqrt(d);
}

// n cosine-weighted directions over the hemisphere facing s along axis a (a Fibonacci spiral).
function hemisphere(a, s, n) {
  const [u, v] = TANGENTS[a];
  return Array.from({ length: n }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / n);
    const phi = i * 2.399963229728653;
    const d = [0, 0, 0];
    d[u] = r * Math.cos(phi);
    d[v] = r * Math.sin(phi);
    d[a] = s * Math.sqrt(1 - r * r);
    return d;
  });
}

// ---- The skyline beyond the walls (bible §2.4, §2.7). Pure data: lists of
// quads { p: 4 corners (12 numbers, counter-clockwise seen from the front), n, color,
// rock?: 1 on cut rock, which world.js overlays with the bedding tile }.
// Azimuths are degrees clockwise from north (−z), seen from above.

export const SKYLINE = {
  seed: 7,
  strata: ['#cdbfa6', '#c2b296', '#d6cab3'], band: 2.5, seam: 0.25, seamColor: '#9a8d78', sand: '#d8c39a',
  // The horseshoe: open from 200° to 290°, toward the sun; each bench is solid back to the
  // next. Below `plain` m the walls always hide a face, so it is one quad, not strata.
  benches: [
    { inner: 46, depth: 12, top: 9, vary: 1, from: 290, to: 560, plain: 5 },
    { inner: 58, depth: 10, top: 15, vary: 1.5, from: 290, to: 560, plain: 7.5 },
    { inner: 68, depth: 6, top: 21, vary: 1.5, from: 330, to: 480, plain: 12.5 },
  ],
  column: 4, step: 0.5, setBack: 1.5, foot: 0.7, // columns cut back 0–1.5 m; faces darken to 70% at the foot
  columnShade: [0.85, 1.08], // each column's face lighter or darker, so the cut reads as blocks
  // Scree at the foot of benches 2 and 3 (bench 1's foot hides behind the walls): a stepped pile
  // [width, depth] per step, total height in m, against every other column; half get a second step.
  scree: { color: '#b9ab92', top: '#d8c39a', steps: [[3.2, 2.6], [1.8, 1.4]], height: [2, 3], firstStep: 0.55, every: 2, twoSteps: 0.5 },
  apron: { half: 75, cell: 15, clear: 15, y: -0.05, colors: ['#c2b59c', '#bcae94', '#c6baa2'], track: '#a99c84' },
  rust: '#8a5a44', bloom: '#6f4535', graphite: '#45474c', windows: '#2a2c30', ochre: '#ad9862', teal: '#4f8f8a', tealWater: '#5f7f7c',
  board: '#c9c3b8', coping: '#d9d4ca', gabion: '#9d968a', cones: ['#d8c39a', '#cbb38a'],
  junction: '#9a9a96', // galvanised: the bible gives no colour, and graphite reads as holes in the wall
  containers: ['#8a5a44', '#5f7f7c', '#ad9862', '#45474c'],
};

// The static skyline mesh: benches, scree, plant and props outside the walls, the
// apron, and the solid wall props inside (cable trays, junction boxes, fence posts).
export function skyline(S = SKYLINE) {
  const out = [];
  const rand = seeded(S.seed);
  const at = (az, r) => [r * Math.sin(rad(az)), -r * Math.cos(rad(az))];

  // Benches: 4 m columns at the inner radius, tops stepped by 0.5 m, cut faces in strata.
  let below = null; // the bench in front: its column tops are the next bench's foot
  for (const b of S.benches) {
    const n = Math.round((rad(b.to - b.from) * b.inner) / S.column);
    const tops = Array.from({ length: n }, () => b.top + Math.round(((rand() * 2 - 1) * b.vary) / S.step) * S.step);
    const cuts = Array.from({ length: n }, () => b.inner + Math.floor(rand() * (S.setBack / S.step + 1)) * S.step);
    const outer = b.inner + b.depth;
    for (let i = 0; i < n; i++) {
      const a0 = b.from + ((b.to - b.from) * i) / n;
      const a1 = b.from + ((b.to - b.from) * (i + 1)) / n;
      const h = tops[i];
      const r = cuts[i];
      const [x0, z0] = at(a0, r);
      const [x1, z1] = at(a1, r);
      const [X0, Z0] = at(a0, outer);
      const [X1, Z1] = at(a1, outer);
      const mid = (a0 + a1) / 2;
      const shade = S.columnShade[0] + (S.columnShade[1] - S.columnShade[0]) * rand();
      const tint = (y) => shade * (S.foot + (1 - S.foot) * Math.min(1, y / h)); // darker toward the foot
      if (below && i % S.scree.every === 0) {
        const k = Math.floor(((mid - below.b.from) / (below.b.to - below.b.from)) * below.tops.length);
        if (k >= 0 && k < below.tops.length) scree(out, at, mid, r, below.tops[k], rand, S.scree);
      }
      strata(out, S, [x0, z0], [x1, z1], 0, h, b.plain, [-Math.sin(rad(mid)), 0, Math.cos(rad(mid))], tint); // the cut face
      quad(out, [[x0, h, z0], [x1, h, z1], [X1, h, Z1], [X0, h, Z0]], S.sand, UP);
      // Column sides, where a neighbour is cut further back or stands lower (or the horseshoe ends).
      for (const [k, az, toward] of [[i - 1, a0, [-Math.cos(rad(a0)), 0, -Math.sin(rad(a0))]], [i + 1, a1, [Math.cos(rad(a1)), 0, Math.sin(rad(a1))]]]) {
        const nr = k >= 0 && k < n ? cuts[k] : outer;
        const nh = k >= 0 && k < n ? tops[k] : 0;
        if (nr > r) strata(out, S, at(az, r), at(az, nr), 0, h, h, toward, tint); // a plain sliver
        if (nh < h && nr < outer) strata(out, S, at(az, Math.max(r, nr)), at(az, outer), nh, h, b.plain, toward, tint);
      }
    }
    below = { b, tops };
  }

  // Crusher tower (hero, backlit in the gap), its hopper and the conveyor between them.
  block(out, [-56, 2, -20], [12, 4, 12], S.graphite);
  block(out, [-56, 15, -20], [10, 22, 10], S.rust);
  for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) block(out, [-56 + dx, 15, -20 + dz], [0.9, 22, 0.9], S.bloom); // corner posts
  block(out, [-56, 13, -26], [2.4, 18, 2], S.graphite); // stair tower
  block(out, [-56, 26.5, -20], [10.6, 1, 10.6], S.graphite);
  block(out, [-56, 28.2, -21.5], [4, 2.4, 4], S.rust);
  for (const y of [10, 15, 20]) block(out, [-50.95, y, -20], [0.1, 1.1, 8], S.windows); // window strips, east face
  for (const y of [10, 15, 20]) block(out, [-56, y, -14.95], [8, 1.1, 0.1], S.windows); // south face
  block(out, [-34, 4.5, -8], [5, 9, 5], S.graphite); // hopper
  block(out, [-34, 9.6, -8], [6, 1.2, 6], S.ochre);
  conveyor(out, [-34, 10.2, -8], [-51, 22, -17.5], S); // lands under the sign's south half
  // Water tower: 8-sided teal tank on 16 m legs.
  prism(out, 52, 26, 16, 24, 4, S.teal, true);
  prism(out, 52, 26, 24, 25.2, 2.2, S.graphite);
  for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) block(out, [52 + dx, 8, 26 + dz], [0.5, 16, 0.5], S.graphite);
  block(out, [52, 8, 23.4], [5.2, 0.3, 0.2], S.graphite);
  block(out, [52, 8, 28.6], [5.2, 0.3, 0.2], S.graphite);
  // Floodlight masts at the corners, lamp heads toward the arena.
  for (const [x, z] of [[23, 23], [-23, 23], [23, -23], [-23, -23]]) {
    block(out, [x, 6.5, z], [0.4, 13, 0.4], S.graphite);
    block(out, [x * 0.97, 13.1, z * 0.97], [1.2, 0.6, 0.4], S.coping, { yaw: Math.atan2(x, z) });
  }
  // Stockpiles: stepped voxel cones, 14 m tall.
  for (const [x, z] of [[24, -28], [-26, 30]]) {
    for (let k = 0; k < 7; k++) block(out, [x, 1 + 2 * k, z], [12 - 1.6 * k, 2, 12 - 1.6 * k], S.cones[k % 2]);
  }
  // Containers peeking over the north wall (2 high) and the south wall (3 high).
  let c = 0;
  const box = (x, y, z) => container(out, [x, y, z], S.containers[c++ % 4]);
  for (const y of [1.3, 3.9]) for (const x of [-8.95, -2.85, 3.25]) box(x, y, -24.5);
  for (const [y, xs] of [[1.3, [-10.95, -4.85]], [3.9, [-11.5, -5.4]], [6.5, [-8.95]]]) for (const x of xs) box(x, y, 24.5);
  // Site cabin on stilts, tanks, and a haul truck in the opening.
  for (const [dx, dz] of [[-1, -2.7], [1, -2.7], [-1, 2.7], [1, 2.7]]) block(out, [25 + dx, 1.3, -10 + dz], [0.25, 2.6, 0.25], S.graphite);
  block(out, [25, 4.1, -10], [2.5, 3, 6], S.board);
  block(out, [25, 5.7, -10], [2.9, 0.2, 6.4], S.graphite);
  block(out, [23.74, 4.4, -10], [0.04, 0.9, 4.4], S.windows);
  prism(out, 26, 8, 0, 6.5, 1.5, S.gabion);
  prism(out, 27, 14, 0, 6.5, 1.5, S.gabion);
  for (const [dx, dz] of [[-1.9, -3], [1.9, -3], [-1.9, 2.6], [1.9, 2.6]]) block(out, [-24 + dx, 1.3, 12 + dz], [1.1, 2.6, 2.6], S.graphite);
  block(out, [-24, 2.4, 12], [3.6, 1, 8.6], S.graphite);
  block(out, [-24, 3.9, 13], [4.5, 2.2, 6.6], S.ochre, { pitch: -0.08 });
  block(out, [-24, 4, 8.2], [2.6, 2.4, 1.8], S.ochre);
  block(out, [-24, 4.5, 7.3], [2.2, 0.8, 0.02], S.windows);

  // The apron: 10 m cells out to 75 m, a little below the arena floor, and a haul road.
  const A = S.apron;
  for (let x = -A.half; x < A.half; x += A.cell) {
    for (let z = -A.half; z < A.half; z += A.cell) {
      if (x >= -A.clear && x + A.cell <= A.clear && z >= -A.clear && z + A.cell <= A.clear) continue;
      quad(out, [[x, A.y, z + A.cell], [x + A.cell, A.y, z + A.cell], [x + A.cell, A.y, z], [x, A.y, z]], A.colors[Math.floor(rand() * A.colors.length)], UP);
    }
  }
  for (const [x0, z0, x1, z1] of [[-44, 40, -44, -30], [-41.5, 40, -41.5, -30], [-44, -30, 40, -34], [-44, -27.5, 40, -31.5]]) {
    const w = 0.5;
    const nx = z1 === z0 ? 0 : w;
    const nz = z1 === z0 ? w : 0;
    quad(out, [[x0 - nx, A.y + 0.02, z0 - nz], [x0 + nx, A.y + 0.02, z0 + nz], [x1 + nx, A.y + 0.02, z1 + nz], [x1 - nx, A.y + 0.02, z1 - nz]], A.track, UP);
  }

  // Inside the arena: cable trays at 3.3 m on the north and east inner faces with junction
  // boxes every 6 m, and fence posts every 3 m along the wall tops.
  for (let k = -18; k <= 18; k += 6) {
    if (k) block(out, [k, 2.95, -19.96], [0.3, 0.4, 0.08], S.junction); // clear of the PIT 7 stencil
    block(out, [19.96, 2.95, k], [0.08, 0.4, 0.3], S.junction);
  }
  block(out, [-50.95, 24.3, -20], [0.1, 3.6, 9.4], S.graphite); // the crusher's sign board, above the conveyor
  block(out, [0, 3.3, -19.95], [40, 0.08, 0.1], S.graphite);
  block(out, [19.95, 3.3, 0], [0.1, 0.08, 40], S.graphite);
  for (let k = -21; k <= 21; k += 3) {
    for (const [x, z] of [[k, -20.5], [k, 20.5], [-20.5, k], [20.5, k]]) block(out, [x, 4.7, z], [0.06, 1.4, 0.06], S.graphite);
  }
  return out;
}

// Decals (§2.7): paint, grates, cracks, oil, stencils and the crusher sign, as
// { c: centre, n: normal, up: texture up, h: height in m, w?: width (else from the atlas
// cell's aspect), cell: atlas name, color, alpha }. They sit 5 mm off their surface.
export function decals(mapBoxes, seed = 3) {
  const rand = seeded(seed);
  const out = [];
  const floor = (x, z, w, h, cell, color, alpha, up = [0, 0, -1]) => out.push({ c: [x, 0, z], n: UP, up, w, h, cell, color, alpha });
  const paint = '#ad9862';
  for (const x of [-11, 11]) for (let z = -18; z + 1 <= 18; z += 1.5) floor(x, z + 0.5, 0.1, 1, 'solid', paint, 0.85);
  for (const [x, z, w, h] of [[0, -19, 38, 0.1], [0, 19, 38, 0.1], [-19, 0, 0.1, 38], [19, 0, 0.1, 38]]) floor(x, z, w, h, 'solid', paint, 0.8);
  [[-15.6, -17.6], [15.6, -17.6], [15.6, 17.6], [-15.6, 17.6]].forEach(([x, z], i) => floor(x, z, undefined, 1.2, `0${i + 1}`, '#45474c', 0.6, [0, 0, Math.sign(z)]));
  for (const z of [-12, -4, 4, 12]) for (const x of [-19, 19]) floor(x, z, 0.6, 0.6, 'grate', '#45474c', 1);
  for (const z of [-19, 19]) floor(0, z, 0.6, 0.6, 'grate', '#45474c', 1);
  // Cracks and oil on open floor, clear of every box.
  const boxes = mapBoxes.slice(1).map(({ pos, size }) => ({ min: pos.map((p, i) => p - size[i] / 2), max: pos.map((p, i) => p + size[i] / 2) }));
  const open = (x, z, r) => Math.abs(x) < 19.5 - r && Math.abs(z) < 19.5 - r && boxes.every((b) => x < b.min[0] - r || x > b.max[0] + r || z < b.min[2] - r || z > b.max[2] + r);
  for (let n = 0; n < 16;) {
    const [x, z, len, a] = [(rand() * 2 - 1) * 19, (rand() * 2 - 1) * 19, 0.5 + rand(), rand() * Math.PI];
    if (open(x, z, len / 2)) n++, floor(x, z, len, len / 4, `crack${n % 2}`, '#8f887d', 0.6, [Math.cos(a), 0, Math.sin(a)]);
  }
  const crates = mapBoxes.filter((b) => b.color === 3);
  for (let n = 0; n < 6;) {
    const b = crates[Math.floor(rand() * crates.length)];
    const a = rand() * 2 * Math.PI;
    const size = 1 + rand();
    const [x, z] = [b.pos[0] + Math.cos(a) * (b.size[0] / 2 + size / 2), b.pos[2] + Math.sin(a) * (b.size[2] / 2 + size / 2)];
    if (open(x, z, 0.2)) n++, floor(x, z, size, size, 'oil', '#6b655c', 0.35, [Math.cos(a), 0, Math.sin(a)]);
  }
  out.push({ c: [0, 2.2, -20], n: [0, 0, 1], up: UP, h: 2, cell: 'PIT 7', color: '#45474c', alpha: 0.8 });
  // Crate stencils on the ±z faces, the variant by box index.
  mapBoxes.forEach((b, i) => {
    if (b.color !== 3) return;
    for (const s of [-1, 1]) out.push({ c: [b.pos[0], b.pos[1] + b.size[1] * 0.1, b.pos[2] + s * (b.size[2] / 2)], n: [0, 0, s], up: UP, h: Math.min(0.16, b.size[1] / 4), cell: `BX-0${(i % 4) + 1}`, color: '#45474c', alpha: 0.85 });
  });
  out.push({ c: [-50.9, 25.0, -20], n: [1, 0, 0], up: UP, h: 1.6, cell: 'BOXFIRE', color: '#d9d4ca', alpha: 1 });
  out.push({ c: [-50.9, 23.3, -20], n: [1, 0, 0], up: UP, h: 1.2, cell: 'QUARRY CO.', color: '#d9d4ca', alpha: 1 });
  return out;
}

// The far group, locked to the camera's x/z and drawn unlit with colours pre-hazed toward
// the horizon: a notched ridge ring with three turbine towers in the opening. Returns
// { quads, hubs: blade hubs, color: the turbines' hazed colour, for the blades }.
export const FAR = {
  seed: 9, inner: 150, outer: 175, columns: 96, height: [30, 45], notch: 0.18,
  sunlit: '#d2d0c8', backlit: '#b5b3b2', top: '#dcdad3',
  // Towers stand on the ridge, but never with their foot above `footCap` m (sunk into a taller
  // column instead), so the nacelle stays inside the 182 m bound: √(166.5² + 73.5²) = 182.
  // Colour: the bible's #f3e7d4, pre-hazed 60% toward the horizon like the ridge, then
  // backlit by the ridge's backlit/sunlit ratio: all three stand in the sun's direction.
  turbines: { radius: 165, azimuths: [215, 245, 275], tower: 40, footCap: 31.5, width: 0.8, nacelle: [2, 2, 3], base: '#f3e7d4', haze: 0.6, blade: [1.2, 14, 0.4], rpm: 12 },
};
export function farRidge(sunDir, F = FAR) {
  const out = [];
  const rand = seeded(F.seed);
  const at = (az, r) => [r * Math.sin(rad(az)), -r * Math.cos(rad(az))];
  const sun = Math.hypot(sunDir[0], sunDir[2]);
  const lit = (nx, nz) => mixHex(F.backlit, F.sunlit, smooth01(((nx * sunDir[0] + nz * sunDir[2]) / sun + 0.35) / 0.7));
  const heights = [];
  const phase = [rand(), rand(), rand()].map((v) => v * 2 * Math.PI);
  for (let i = 0; i < F.columns; i++) {
    const az = (360 * (i + 0.5)) / F.columns;
    const [lo, hi] = F.height;
    const wave = 0.5 + 0.25 * Math.sin(rad(az) * 2 + phase[0]) + 0.15 * Math.sin(rad(az) * 5 + phase[1]) + 0.1 * Math.sin(rad(az) * 11 + phase[2]);
    let h = lo + (hi - lo) * wave;
    if (rand() < F.notch) h -= 4 + rand() * 6; // notches
    heights.push(Math.round(h));
  }
  for (let i = 0; i < F.columns; i++) {
    const a0 = (360 * i) / F.columns;
    const a1 = (360 * (i + 1)) / F.columns;
    const [x0, z0] = at(a0, F.inner);
    const [x1, z1] = at(a1, F.inner);
    const [X0, Z0] = at(a0, F.outer);
    const [X1, Z1] = at(a1, F.outer);
    const h = heights[i];
    const mid = (a0 + a1) / 2;
    const inward = [-Math.sin(rad(mid)), 0, Math.cos(rad(mid))];
    const ccw = [-Math.cos(rad(a0)), 0, -Math.sin(rad(a0))];
    const cw = [Math.cos(rad(a1)), 0, Math.sin(rad(a1))];
    quad(out, [[x1, 0, z1], [x0, 0, z0], [x0, h, z0], [x1, h, z1]], lit(inward[0], inward[2]), inward);
    quad(out, [[x0, h, z0], [x1, h, z1], [X1, h, Z1], [X0, h, Z0]], F.top, UP);
    const prev = heights[(i + F.columns - 1) % F.columns];
    const next = heights[(i + 1) % F.columns];
    if (prev < h) quad(out, [[x0, prev, z0], [X0, prev, Z0], [X0, h, Z0], [x0, h, z0]], lit(ccw[0], ccw[2]), ccw);
    if (next < h) quad(out, [[X1, next, Z1], [x1, next, z1], [x1, h, z1], [X1, h, Z1]], lit(cw[0], cw[2]), cw);
  }
  // Turbine towers on the ridge, nacelles facing the arena; hubs for the blades.
  const T = F.turbines;
  const color = shadeHex(mixHex(T.base, '#d6dbdf', T.haze), hexRgb(F.backlit)[1] / hexRgb(F.sunlit)[1]);
  const hubs = T.azimuths.map((az) => {
    const [x, z] = at(az, T.radius);
    const base = Math.min(heights[Math.floor((az / 360) * F.columns)], T.footCap) - 2;
    const yaw = Math.PI - rad(az); // local z points out from the arena
    block(out, [x, base + T.tower / 2, z], [T.width, T.tower, T.width], color, { yaw });
    block(out, [x, base + T.tower + 1, z], T.nacelle, color, { yaw });
    const [hx, hz] = at(az, T.radius - T.nacelle[2] / 2 - 0.3);
    return { x: hx, y: base + T.tower + 1, z: hz, yaw };
  });
  return { quads: out, hubs, color };
}

// Clouds: clusters of voxel boxes, some side by side and some stacked on the first, each
// vertex tagged with its cluster's centre so the shader can drift and wrap whole clusters.
// Sides shade toward the underside colour at their lower edge, so a cluster reads as a volume.
export const CLOUDS = {
  seed: 5, count: 14, reach: [100, 140], altitude: [60, 85], boxes: [3, 5], size: [12, 30], thickness: [5, 9],
  stacked: 0.4, sideFoot: 0.45,
  top: '#ffffff', side: '#e8eef5', sunSide: '#fff1de', bottom: '#b3c0d4',
};
export function clouds(sunDir, C = CLOUDS) {
  const out = [];
  const rand = seeded(C.seed);
  const pick = ([a, b]) => a + (b - a) * rand();
  const faceColor = (n) => (n[1] > 0.5 ? C.top : n[1] < -0.5 ? C.bottom : n[0] * sunDir[0] + n[2] * sunDir[2] > 0.1 ? C.sunSide : C.side);
  for (let i = 0; i < C.count; i++) {
    const r = pick(C.reach);
    const angle = rand() * 2 * Math.PI;
    const centre = [r * Math.cos(angle), pick(C.altitude), r * Math.sin(angle)];
    const n = Math.round(pick(C.boxes));
    let base = null;
    for (let k = 0; k < n; k++) {
      const onTop = base && rand() < C.stacked;
      const w = onTop ? base.w * (0.4 + 0.3 * rand()) : pick(C.size);
      const size = [w, pick(C.thickness) * (onTop ? 0.7 : 1), w * (0.4 + 0.5 * rand())];
      const spread = (onTop ? base.w * 0.3 : w * 0.8);
      const y = onTop ? base.y + base.h / 2 + size[1] / 2 - 1 : centre[1] + (rand() - 0.5) * 2;
      const at = [(onTop ? base.x : centre[0]) + (rand() - 0.5) * spread, y, (onTop ? base.z : centre[2]) + (rand() - 0.5) * spread];
      if (!base) base = { x: at[0], y: at[1], z: at[2], w, h: size[1] };
      const first = out.length;
      block(out, at, size, faceColor, { bottom: !onTop });
      for (let q = first; q < out.length; q++) {
        const f = out[q];
        f.centre = centre;
        if (Math.abs(f.n[1]) < 0.5) {
          const foot = mixHex(f.color, C.bottom, C.sideFoot);
          f.color = [0, 1, 2, 3].map((c) => (f.p[c * 3 + 1] < at[1] ? foot : f.color));
        }
      }
    }
  }
  return out;
}

// ---- Quad helpers.
const rad = (deg) => (deg * Math.PI) / 180;
const UP = [0, 1, 0];
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const shadeHex = (hex, k) => '#' + hexRgb(hex).map((v) => Math.round(Math.min(255, v * k)).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, t) => '#' + hexRgb(a).map((v, i) => Math.round(v + (hexRgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A quad from 4 corners in order around it, in one colour or one per corner; its normal
// (and front) follows the right-hand rule, flipped to face `toward` when given.
function quad(out, corners, color, toward) {
  const [a, b, , d] = corners;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n) || 1;
  if (toward && n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] < 0) return quad(out, [...corners].reverse(), Array.isArray(color) ? [...color].reverse() : color);
  out.push({ p: corners.flat(), n: n.map((x) => x / len), color });
}

// A box at centre c with size [w, h, d], turned by yaw about y after pitch about x.
// color is a hex or a function of the face normal. Bottom faces only when asked.
function block(out, c, size, color, { yaw = 0, pitch = 0, bottom = false } = {}) {
  const [cy, sy, cp, sp] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch)];
  const turn = ([x, y, z]) => {
    const y1 = y * cp - z * sp;
    const z1 = y * sp + z * cp;
    return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
  };
  const corner = (i, j, k) => turn([(i - 0.5) * size[0], (j - 0.5) * size[1], (k - 0.5) * size[2]]).map((v, a) => v + c[a]);
  const faces = [
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], // +x
    [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], // −x
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // +y
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // −y
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +z
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // −z
  ];
  for (let f = 0; f < 6; f++) {
    if (f === 3 && !bottom) continue;
    const corners = faces[f].map(([i, j, k]) => corner(i, j, k));
    quad(out, corners, typeof color === 'function' ? null : color);
    if (typeof color === 'function') out[out.length - 1].color = color(out[out.length - 1].n);
  }
}

// An n-sided upright prism (8 by default) of radius r from y0 to y1, with a lid.
function prism(out, x, z, y0, y1, r, color, bottom = false, sides = 8) {
  const p = Array.from({ length: sides }, (_, i) => [x + r * Math.cos(((i + 0.5) * 2 * Math.PI) / sides), z + r * Math.sin(((i + 0.5) * 2 * Math.PI) / sides)]);
  for (let i = 0; i < sides; i++) {
    const [ax, az] = p[i];
    const [bx, bz] = p[(i + 1) % sides];
    quad(out, [[bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz]], color);
  }
  for (const y of bottom ? [y1, y0] : [y1]) {
    const lid = (k) => [p[k][0], y, p[k][1]];
    const fan = [[0, 1, 2, 3], [0, 3, 4, 7], [7, 4, 5, 6]];
    for (const f of fan) quad(out, (y === y1 ? [...f].reverse() : f).map(lid), color);
  }
}

// A vertical cut face along a–b between heights y0 and y1, facing `toward`, in strata bands
// with seams (one plain quad below `plain`), its colours scaled by tint(y).
function strata(out, S, a, b, y0, y1, plain, toward, tint = () => 1) {
  const face = (l, h, color) => {
    const [cl, ch] = [shadeHex(color, tint(l)), shadeHex(color, tint(h))];
    quad(out, [[a[0], l, a[1]], [b[0], l, b[1]], [b[0], h, b[1]], [a[0], h, a[1]]], [cl, cl, ch, ch], toward);
    out[out.length - 1].rock = 1;
  };
  if (y0 < plain) {
    face(y0, Math.min(plain, y1), S.strata[1]);
    y0 = Math.min(plain, y1);
  }
  for (let base = Math.floor(y0 / S.band) * S.band; base < y1; base += S.band) {
    const k = Math.round(base / S.band);
    for (const [lo, hi, color] of [[base, base + S.band - S.seam, S.strata[k % S.strata.length]], [base + S.band - S.seam, base + S.band, S.seamColor]]) {
      const l = Math.max(lo, y0);
      const h = Math.min(hi, y1);
      if (h > l + 1e-6) face(l, h, color);
    }
  }
}

// A scree pile against the cut face at azimuth az, radius r, on the bench top at height y:
// stepped boxes (top, front and sides; the back is in the rock) spilling toward the arena.
function scree(out, at, az, r, y, rand, P) {
  const inward = [-Math.sin(rad(az)), 0, Math.cos(rad(az))];
  const along = [Math.cos(rad(az)), 0, Math.sin(rad(az))];
  const total = P.height[0] + (P.height[1] - P.height[0]) * rand();
  const steps = rand() < P.twoSteps ? 2 : 1;
  const shift = (rand() - 0.5) * 0.8; // off the column's centre along the face
  for (let k = 0; k < steps; k++) {
    const [w, d] = P.steps[k];
    const y0 = k ? y + total * P.firstStep : y;
    const y1 = k ? y + total : y0 + total * P.firstStep;
    const [cx, cz] = at(az, r);
    const pt = (t, depth, yy) => [cx + along[0] * (t + shift) + inward[0] * depth, yy, cz + along[2] * (t + shift) + inward[2] * depth];
    const [l, m] = [-w / 2, w / 2];
    quad(out, [pt(l, 0, y1), pt(m, 0, y1), pt(m, d, y1), pt(l, d, y1)], P.top, UP); // sand settles on top
    quad(out, [pt(l, d, y0), pt(m, d, y0), pt(m, d, y1), pt(l, d, y1)], P.color, inward);
    out[out.length - 1].rock = 1;
    quad(out, [pt(l, 0, y0), pt(l, d, y0), pt(l, d, y1), pt(l, 0, y1)], P.color, along.map((v) => -v));
    out[out.length - 1].rock = 1;
    quad(out, [pt(m, 0, y0), pt(m, d, y0), pt(m, d, y1), pt(m, 0, y1)], P.color, along);
    out[out.length - 1].rock = 1;
  }
}

// A shipping container: a box with a dark door end.
function container(out, c, color) {
  block(out, c, [6.1, 2.6, 2.44], color);
  block(out, [c[0] + 3.06, c[1], c[2]], [0.04, 2.3, 2.2], '#3a3c40');
}

// A sloped conveyor truss from a to b with ochre rails and two legs.
function conveyor(out, a, b, S) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const flat = Math.hypot(d[0], d[2]);
  const len = Math.hypot(flat, d[1]);
  const yaw = Math.atan2(d[0], d[2]);
  const pitch = -Math.atan2(d[1], flat);
  const mid = a.map((v, i) => v + d[i] / 2);
  block(out, mid, [2, 1.2, len], S.graphite, { yaw, pitch, bottom: true });
  for (const side of [-1, 1]) {
    const off = [Math.cos(yaw) * side * 0.95, 0.7, -Math.sin(yaw) * side * 0.95];
    block(out, mid.map((v, i) => v + off[i]), [0.12, 0.25, len], S.ochre, { yaw, pitch });
  }
  for (const t of [0.35, 0.7]) block(out, [a[0] + d[0] * t, (a[1] + d[1] * t) / 2, a[2] + d[2] * t], [0.5, a[1] + d[1] * t, 0.5], S.graphite);
}
