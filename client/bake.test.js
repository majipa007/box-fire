import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { meshMap } from './bake.js';

const AO = { cell: 0.5, rays: 16, radius: 1.5, strength: 0.6 };
const arena = JSON.parse(fs.readFileSync(new URL('../shared/maps/arena_01.json', import.meta.url)));

// A floor, a wall along its +x edge, a lone crate, a crate in the wall's corner and a stack.
const SMALL = [
  { pos: [0, -0.5, 0], size: [10, 1, 10], mat: 'floor' },
  { pos: [5.5, 1, 0], size: [1, 2, 10], mat: 'wall' },
  { pos: [0, 0.5, 0], size: [1, 1, 1], mat: 'crate' },
  { pos: [4.5, 0.5, 0], size: [1, 1, 1], mat: 'crate' },
  { pos: [-3, 0.5, 3], size: [1, 1, 1], mat: 'crate' },
  { pos: [-3, 1.5, 3], size: [1, 1, 1], mat: 'crate', top: 'lid' },
];
const boxesOf = (list) => list.map(({ pos, size }) => ({ min: pos.map((p, i) => p - size[i] / 2), max: pos.map((p, i) => p + size[i] / 2) }));
const inside = (p, boxes) => boxes.some((b) => p.every((v, i) => b.min[i] < v && v < b.max[i]));

// Every triangle as { mat, v: [3 vertex ids], m: the mesh's arrays }.
function triangles(meshes) {
  const out = [];
  for (const [mat, m] of Object.entries(meshes)) {
    for (let i = 0; i < m.index.length; i += 3) out.push({ mat, m, v: [m.index[i], m.index[i + 1], m.index[i + 2]] });
  }
  return out;
}
const pos = (m, i) => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
const nrm = (m, i) => [m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The AO of the vertex at p on the face with normal n.
function aoAt(meshes, p, n) {
  for (const m of Object.values(meshes)) {
    for (let i = 0; i < m.ao.length; i++) {
      if (sub(pos(m, i), p).every((d) => Math.abs(d) < 1e-6) && dot(nrm(m, i), n) > 0.5) return m.ao[i];
    }
  }
  assert.fail(`no vertex at ${p} facing ${n}`);
}

test('only faces open to the air are meshed, and every open face is', () => {
  const { meshes } = meshMap(SMALL, AO);
  const boxes = boxesOf(SMALL);
  const tris = triangles(meshes);
  // Nothing hidden: each triangle's centre, nudged along its normal, is in the air and above the floor.
  for (const { m, v } of tris) {
    const n = nrm(m, v[0]);
    const c = [0, 1, 2].map((k) => (pos(m, v[0])[k] + pos(m, v[1])[k] + pos(m, v[2])[k]) / 3 + n[k] * 1e-3);
    assert.ok(!inside(c, boxes), `hidden face at ${c}`);
    assert.ok(!(n[1] < 0 && c[1] <= 0), 'a face looks down from the floor');
    assert.ok(Math.abs(c[0]) < 6 && Math.abs(c[2]) < 5 + 1e-3, `a face looks out of the map at ${c}`);
  }
  // Nothing missing: sample the open top faces; each point lies on some up-facing triangle.
  const ups = tris.filter(({ m, v }) => nrm(m, v[0])[1] > 0.5);
  const covered = (x, y, z) => ups.some(({ m, v }) => {
    const [a, b, c] = v.map((i) => pos(m, i));
    if (Math.abs(a[1] - y) > 1e-6) return false;
    const s = (p, q) => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
    const [d1, d2, d3] = [s(a, b), s(b, c), s(c, a)];
    return (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
  });
  for (let x = -4.9; x < 5; x += 0.37) {
    for (let z = -4.9; z < 5; z += 0.41) {
      const open = !inside([x, 1e-3, z], boxes);
      assert.equal(covered(x, 0, z), open, `floor at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
  assert.ok(covered(-3, 2, 3), 'the top of the stack');
  assert.ok(!covered(-3, 1, 3), 'the hidden join inside the stack');
  assert.ok(meshes.lid && !meshes.lid.normal.some((v, i) => i % 3 === 1 && v < 0.5), 'top overrides only the top face');
});

test('triangles face outward', () => {
  for (const { m, v } of triangles(meshMap(SMALL, AO).meshes)) {
    const [a, b, c] = v.map((i) => pos(m, i));
    assert.ok(dot(cross(sub(b, a), sub(c, a)), nrm(m, v[0])) > 0, `inward triangle at ${a}`);
  }
});

test('touching faces share vertices: no T-junction cracks anywhere in arena_01', () => {
  const { meshes } = meshMap(arena.boxes, AO);
  const cells = new Map(); // 1 m buckets of every vertex
  const key = (p) => p.map(Math.floor).join();
  for (const m of Object.values(meshes)) {
    for (let i = 0; i < m.ao.length; i++) {
      const p = pos(m, i);
      if (!cells.has(key(p))) cells.set(key(p), []);
      cells.get(key(p)).push(p);
    }
  }
  for (const { m, v } of triangles(meshes)) {
    for (let e = 0; e < 3; e++) {
      const a = pos(m, v[e]);
      const b = pos(m, v[(e + 1) % 3]);
      const ab = sub(b, a);
      const len2 = dot(ab, ab);
      const near = new Set([key(a), key(b), key(a.map((x, k) => (x + b[k]) / 2))]);
      for (const k of near) {
        for (const p of cells.get(k) ?? []) {
          const t = dot(sub(p, a), ab) / len2;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          const off = sub(p, a.map((x, k2) => x + ab[k2] * t));
          assert.ok(dot(off, off) > 1e-10, `vertex ${p} splits an edge from ${a} to ${b}`);
        }
      }
    }
  }
});

test('AO: open floor is unlit by it, creases are darker, corners darker still', () => {
  const { meshes } = meshMap(SMALL, AO);
  const up = [0, 1, 0];
  const open = aoAt(meshes, [-3, 0, -3], up);
  const crease = aoAt(meshes, [-0.5, 0, 0], up); // foot of the lone crate
  const corner = aoAt(meshes, [5, 0, 0.5], up); // floor, wall and crate meet
  assert.equal(open, 1);
  assert.ok(crease < 0.85 && crease > 0.6, `crease ${crease}`);
  assert.ok(corner < crease, `corner ${corner} vs crease ${crease}`);
  assert.ok(aoAt(meshes, [-0.5, 1, 0], up) === 1, 'a convex top edge is open');
  for (const m of Object.values(meshes)) for (const a of m.ao) assert.ok(a >= 1 - AO.strength && a <= 1);
});

test('quads split along their brighter diagonal', () => {
  for (const m of Object.values(meshMap(arena.boxes, AO).meshes)) {
    for (let i = 0; i < m.index.length; i += 6) {
      const [t1, t2] = [m.index.slice(i, i + 3), m.index.slice(i + 3, i + 6)];
      const shared = [...t1].filter((x) => t2.includes(x));
      const others = [...t1, ...t2].filter((x) => !shared.includes(x));
      assert.equal(shared.length, 2);
      assert.ok(m.ao[shared[0]] + m.ao[shared[1]] >= m.ao[others[0]] + m.ao[others[1]] - 1e-6); // float32 storage
    }
  }
});

test('UVs are world metres, upright and unmirrored seen from the front', () => {
  const { meshes } = meshMap(SMALL, AO);
  const uvAt = (p, n) => {
    for (const m of Object.values(meshes)) {
      for (let i = 0; i < m.ao.length; i++) {
        if (sub(pos(m, i), p).every((d) => Math.abs(d) < 1e-6) && dot(nrm(m, i), n) > 0.5) return [m.uv[i * 2], m.uv[i * 2 + 1]];
      }
    }
    return null;
  };
  assert.deepEqual(uvAt([-3, 0, -3], [0, 1, 0]), [-3, 3]); // top: x, −z
  assert.deepEqual(uvAt([0.5, 0.5, 0], [1, 0, 0]), [-0, 0.5]); // +x side: −z, y
  assert.deepEqual(uvAt([0, 0.5, 0.5], [0, 0, 1]), [0, 0.5]); // +z side: x, y
});

test('edges darken only where a face turns away, not where it runs into another box', () => {
  const { meshes } = meshMap(SMALL, AO);
  const edgeDistance = (p, n) => {
    for (const m of Object.values(meshes)) {
      for (let i = 0; i < m.ao.length; i++) {
        if (sub(pos(m, i), p).every((d) => Math.abs(d) < 1e-6) && dot(nrm(m, i), n) > 0.5) {
          const [u, v, w, h] = m.face.slice(i * 4, i * 4 + 4);
          return Math.min(u, v, w - u, h - v);
        }
      }
    }
    return null;
  };
  assert.equal(edgeDistance([-0.5, 1, 0], [0, 1, 0]), 0); // crate top edge: convex
  assert.equal(edgeDistance([-0.5, 0, 0], [-1, 0, 0]), 0.5); // crate side at the floor: a crease; its sides are 0.5 m off
  assert.ok(edgeDistance([5, 0, -3], [0, 1, 0]) > 1); // floor at the wall: a crease
});

test('arena_01 stays within the triangle budget', () => {
  const { triangles: n } = meshMap(arena.boxes, AO);
  assert.ok(n < 40000, `${n} triangles`);
});
