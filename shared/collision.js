// Axis-aligned boxes. A mover is feet-anchored: x/z are its centre, y is the
// bottom of its box.
const EPS = 1e-6;

// Map JSON (centre + size) → boxes as min/max triples, prepared once.
export function prepareMap(map) {
  return {
    boxes: map.boxes.map(({ pos, size }) => ({
      min: pos.map((p, i) => p - size[i] / 2),
      max: pos.map((p, i) => p + size[i] / 2),
    })),
    spawns: map.spawns,
    pads: map.pads ?? [], // power-up pads: { pos, pool, respawn }
  };
}

function bounds(s, half, height) {
  return [[s.x - half, s.y, s.z - half], [s.x + half, s.y + height, s.z + half]];
}

// Distance along a unit ray to where it enters a box (0 if it starts inside),
// or Infinity if it never does. Slab method.
export function rayBox(origin, dir, min, max) {
  let near = 0;
  let far = Infinity;
  for (let a = 0; a < 3; a++) {
    if (dir[a] === 0) {
      if (origin[a] < min[a] || origin[a] > max[a]) return Infinity;
      continue;
    }
    let t1 = (min[a] - origin[a]) / dir[a];
    let t2 = (max[a] - origin[a]) / dir[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return Infinity;
  }
  return near;
}

// Does a mover of this size intersect any box?
export function overlaps(s, half, height, boxes) {
  const [min, max] = bounds(s, half, height);
  return boxes.some((b) => [0, 1, 2].every((a) => min[a] < b.max[a] - EPS && max[a] > b.min[a] + EPS));
}

// How far a mover can travel along `axis` (0 x, 1 y, 2 z) before touching a
// box face: an exact swept test, so no speed can tunnel through anything.
export function sweep(s, half, height, axis, delta, boxes) {
  if (delta === 0) return 0;
  const [min, max] = bounds(s, half, height);
  const a1 = (axis + 1) % 3;
  const a2 = (axis + 2) % 3;
  for (const b of boxes) {
    if (min[a1] >= b.max[a1] - EPS || max[a1] <= b.min[a1] + EPS) continue;
    if (min[a2] >= b.max[a2] - EPS || max[a2] <= b.min[a2] + EPS) continue;
    if (delta > 0 && max[axis] <= b.min[axis] + EPS) delta = Math.min(delta, b.min[axis] - max[axis]);
    else if (delta < 0 && min[axis] >= b.max[axis] - EPS) delta = Math.max(delta, b.max[axis] - min[axis]);
  }
  return delta;
}
