// Static-world baking with no three.js and no DOM, so Node can test it.
// world.js turns the arrays and quads made here into meshes.
import { rayBox } from '../shared/collision.js';

const q = (v) => Math.round(v * 1e4) / 1e4; // 0.1 mm grid: equal box edges compare equal
const TANGENTS = [[2, 1], [0, 2], [0, 1]]; // [u, v] axes per normal axis; v is up on side faces
const CROSS = [-1, -1, 1]; // sign of u × v along the normal axis, for the winding
const NUDGE = 1e-3; // m: probes start this far in front of a face
const NO_EDGE = 100; // m added to a face-local coordinate to switch that edge's darkening off

// Map boxes ({ pos, size, mat, top? }) → { meshes: { [material]: arrays }, triangles }.
// Arrays per material: position, normal, uv (world metres), ao (0–1), face
// (face-local u, v, width, height in metres, for edge darkening) and index.
// - Faces are cut on one global grid per axis: every box edge, filled to
//   `cell` metres. Touching faces therefore share vertices (no T-junction
//   cracks), and every contact line gets its own row of vertices, so the AO
//   crease is crisp.
// - Hidden faces: cells inside another box, faces under the floor and faces
//   looking out of the map footprint are dropped.
// - AO: each vertex casts `rays` cosine-weighted rays up to `radius` m;
//   AO = 1 − strength × mean(1 − hit / radius). Each quad is split along its
//   brighter diagonal (0fps), so occlusion never streaks.
// - Edges that run into another box are creases, and get no darkening.
export function meshMap(mapBoxes, { cell, rays, radius, strength }) {
  const boxes = mapBoxes.map(({ pos, size, mat, top }) => ({
    min: pos.map((p, i) => q(p - size[i] / 2)),
    max: pos.map((p, i) => q(p + size[i] / 2)),
    mat,
    top: top ?? mat,
  }));
  const lines = [0, 1, 2].map((a) => gridLines(boxes, a, cell));
  const lo = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
  const floor = Math.min(...boxes.map((b) => b.max[1])); // the lowest top: nothing is seen from below it
  // Rays test slightly shrunk boxes, so a probe on a contact line only counts the box it faces.
  const solid = boxes.map((b) => ({ min: b.min.map((v) => v + 1e-4), max: b.max.map((v) => v - 1e-4) }));
  const solidAt = (p) => boxes.some((b) => p.every((v, i) => b.min[i] < v && v < b.max[i]));
  const fans = [0, 1, 2].map((a) => ({ [-1]: hemisphere(a, -1, rays), 1: hemisphere(a, 1, rays) }));
  const origin = [0, 0, 0];
  const local = [];

  function occlusion(p, a, s, near) {
    origin[0] = p[0];
    origin[1] = p[1];
    origin[2] = p[2];
    origin[a] += s * NUDGE;
    local.length = 0;
    for (const c of near) if (distance(origin, c) < radius) local.push(c);
    if (!local.length) return 1;
    let occluded = 0;
    for (const d of fans[a][s]) {
      let t = radius;
      for (const c of local) t = Math.min(t, rayBox(origin, d, c.min, c.max));
      occluded += 1 - t / radius;
    }
    return 1 - (strength * occluded) / rays;
  }

  const meshes = {};
  let triangles = 0;
  boxes.forEach((b, self) => {
    for (let a = 0; a < 3; a++) {
      const [u, v] = TANGENTS[a];
      for (const s of [-1, 1]) {
        const plane = s > 0 ? b.max[a] : b.min[a];
        const hidden = a === 1 ? s < 0 && plane <= floor : b.max[1] <= floor || plane === (s > 0 ? hi[a] : lo[a]);
        if (hidden) continue;
        const out = (meshes[a === 1 && s > 0 ? b.top : b.mat] ??= { position: [], normal: [], uv: [], ao: [], face: [], index: [] });
        const us = slice(lines[u], b.min[u], b.max[u]);
        const vs = slice(lines[v], b.min[v], b.max[v]);
        const front = plane + s * NUDGE;
        const reach = { min: [...b.min], max: [...b.max] };
        reach.min[a] = s > 0 ? plane : plane - radius;
        reach.max[a] = s > 0 ? plane + radius : plane;
        for (const t of [u, v]) {
          reach.min[t] -= radius;
          reach.max[t] += radius;
        }
        const near = solid.filter((c, i) => i !== self && c.min.every((m, k) => m < reach.max[k] && c.max[k] > reach.min[k]));
        const crease = (t, side) => {
          const o = t === u ? v : u;
          const p = [];
          p[a] = front;
          p[t] = side < 0 ? b.min[t] - NUDGE : b.max[t] + NUDGE;
          p[o] = (b.min[o] + b.max[o]) / 2;
          return solidAt(p) ? NO_EDGE : 0;
        };
        const ku = crease(u, -1);
        const kv = crease(v, -1);
        const width = b.max[u] - b.min[u] + ku + crease(u, 1);
        const height = b.max[v] - b.min[v] + kv + crease(v, 1);
        const su = a === 0 ? -s : a === 2 ? s : 1; // world UVs, unmirrored seen from the front
        const sv = a === 1 ? -s : 1;
        const ids = new Map();
        const vertex = (i, j) => {
          const key = i * vs.length + j;
          let id = ids.get(key);
          if (id === undefined) {
            id = out.ao.length;
            ids.set(key, id);
            const p = [0, 0, 0];
            p[a] = plane;
            p[u] = us[i];
            p[v] = vs[j];
            out.position.push(...p);
            out.normal.push(a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0);
            out.uv.push(su * p[u], sv * p[v]);
            out.face.push(p[u] - b.min[u] + ku, p[v] - b.min[v] + kv, width, height);
            out.ao.push(occlusion(p, a, s, near));
          }
          return id;
        };
        const centre = [0, 0, 0];
        centre[a] = front;
        for (let i = 0; i + 1 < us.length; i++) {
          for (let j = 0; j + 1 < vs.length; j++) {
            centre[u] = (us[i] + us[i + 1]) / 2;
            centre[v] = (vs[j] + vs[j + 1]) / 2;
            if (solidAt(centre)) continue; // hidden inside another box
            const v00 = vertex(i, j);
            const v10 = vertex(i + 1, j);
            const v11 = vertex(i + 1, j + 1);
            const v01 = vertex(i, j + 1);
            const { ao } = out;
            const tris = ao[v00] + ao[v11] >= ao[v10] + ao[v01] ? [v00, v10, v11, v00, v11, v01] : [v00, v10, v01, v10, v11, v01];
            if (CROSS[a] * s < 0) tris.reverse();
            out.index.push(...tris);
            triangles += 2;
          }
        }
      }
    }
  });
  for (const m of Object.values(meshes)) {
    for (const k of ['position', 'normal', 'uv', 'ao', 'face']) m[k] = new Float32Array(m[k]);
    m.index = new Uint32Array(m.index);
  }
  return { meshes, triangles };
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

// One face of a box as a quad, counter-clockwise seen from outside.
function boxFace(min, max, a, s, color, out) {
  const [u, v] = TANGENTS[a];
  const corner = (cu, cv) => {
    const p = [0, 0, 0];
    p[a] = s > 0 ? max[a] : min[a];
    p[u] = cu ? max[u] : min[u];
    p[v] = cv ? max[v] : min[v];
    return p;
  };
  const corners = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
  if (CROSS[a] * s < 0) corners.reverse();
  const n = [0, 0, 0];
  n[a] = s;
  out.push({ p: corners.flat(), n, color });
}
