// Short-lived visual effects (bible §3.3), pooled so a shot allocates nothing.
// Six draws, one per pool, each drawing only its live instances (swap-remove):
//   cubes   - lit debris with CPU physics: chips, splinters, hit cubes,
//             casings, blast and death voxels;
//   sparks  - points: steel sparks, shield hexagons, shock and bolt sparks;
//   dust    - points: impact puffs;
//   decals  - lit quads on the hit face: bullet holes and scorches;
//   streaks - normal-blended quads: tracers, beams, rings, bands, puffs;
//   glows   - additive quads: muzzle flashes and blast glows, the only
//             additive pool.
// Everything else is normal-blended with a light core and a dark fringe, so
// it reads against a sunlit wall and the sky alike. ?debug&fx[=timescale]
// runs a scripted loop of every effect in front of the camera.
import * as THREE from 'three';
import { SHOT_RANGE, POWER_COLORS, POWERS } from '../shared/constants.js';
import { prepareMap, rayBox } from '../shared/collision.js';
import { hitboxes } from '../shared/weapons.js';
import { PLAYER_FLAGS } from '../shared/protocol.js';

// ---------------------------------------------------------------------------
// Look: every number from the bible's table, for the art pass. Metres,
// seconds and m/s; [min, max] pairs are ranges picked from at random.
// 'pellet' is one shotgun pellet; counts are per bullet or pellet.
const LOOK = {
  nearFade: [0.3, 1.5], // m from the camera: particles fade (cubes shrink) to nothing inside this
  gravity: 20,
  cubes: { restitution: 0.3, minBounce: 0.8, slide: 0.6, groundDrag: 6, settle: 12, shrink: 0.6, shade: 0.08 },
  caps: { chips: 12, puffs: 3 }, // per shot event, however many pellets
  concrete: {
    chips: { rifle: 5, pistol: 4, pellet: 2, bolt: 3 }, size: [0.025, 0.05], speed: [2, 4], life: [0.6, 1],
    puff: '#d9d2c4', puffAlpha: 0.5, puffSize: [0.25, 0.6], puffLife: 0.4,
    decal: ['#2a2724', '#e4ded2'],
  },
  wood: { chips: 4, size: [0.015, 0.015, 0.06], speed: [2, 3], life: [0.8, 0.8], color: '#c6a77a', decal: ['#3a2a1a', '#c6a77a'] },
  steel: { sparks: 6, px: 3, speed: [6, 10], life: 0.2, color: '#ff8a3d', decal: ['#2a2a2a', '#b0b0b0'] },
  spark: { core: '#fff1c9', edge: '#3a2a20', stretch: 0.035, maxPx: 48 }, // a hot core, the rim colour, a dark edge; streaked over `stretch` s of flight, at most maxPx long
  shade: [0.36, 0.4, 0.48], // unlit puffs in the sun's shadow take this (linear) tint of skylight
  decal: { size: { rifle: 0.07, pistol: 0.06, pellet: 0.045, bolt: 0.08 }, core: 0.42, halo: 0.85, lift: 0.004, minFit: 0.6 },
  player: { cubes: 4, headCubes: 7, size: [0.04, 0.07], speed: [1.5, 3], life: 0.5, white: '#ffffff', unknown: '#9a9fa8' },
  shield: { sparks: 5, size: 0.05, speed: [3, 5], life: 0.25, color: '#66fff0', edge: '#15171c' },
  tracer: { length: { rifle: 3, pistol: 2, pellet: 1.5 }, width: 0.02, widthPerM: 0.0012, speed: 400, core: '#fff1c9', tail: '#ffb85c', fringe: '#3a2a20', fringeAlpha: 0.45 },
  bolt: { width: 0.06, widthPerM: 0.001, zig: 0.05, life: 0.14, core: '#e8f4ff', body: '#2e9bff', fringe: '#15171c', fringeAlpha: 0.4, sparks: 6 },
  muzzle: { star: 0.35, glow: 0.6, life: 0.05, color: '#ffd27a' }, // warms to #ff8a3d at the edge
  casing: {
    rifle: { size: [0.012, 0.012, 0.035], color: '#c9a24e' },
    pistol: { size: [0.01, 0.01, 0.022], color: '#c9a24e' },
    shotgun: { size: [0.024, 0.024, 0.06], color: '#b33a2e' },
    speed: 2, up: 1.6, jitter: 0.3, spin: 15, life: 2, range: 15,
  },
  blast: {
    voxels: 24, voxelSize: [0.08, 0.16], speed: [3, 8], life: 1.2, colors: ['#45474c', '#ad9862', null], // null: the item hue
    grow: 0.18, ringBand: 0.3, ringLife: 0.3,
    glow: [0.5, 3], glowLife: 0.3, glowColor: '#ffd27a',
    puffs: 8, fire: 4, fireColor: '#ffb347', fireSize: [0.7, 2], fireLife: 0.6, fireHeat: 0.35, // the first `fire` puffs burn, then smoke
    puffSize: [1, 2.8], puffLife: 1.2, puffAlpha: 0.7, puffColors: ['#6b655c', '#d9d2c4'],
    flash: [1, 2.6], flashLife: 0.08, flashColor: '#fff1c9',
    scorch: 1.6, scorchColor: '#2a2522', scorchAlpha: 0.6, scorchLife: 20, scorchReach: 1.5, // m below the blast it still marks
  },
  barge: { grow: 0.18, life: 0.3, height: 0.4, thick: 0.25, segments: 16 },
  shock: { beam: [30, 0.6], ring: 2.5, sparks: 16, sparkSpeed: [4, 8], life: 0.25, glow: 2.4 },
  fizzle: { puffs: 6, voxels: 4, voxelSize: 0.06, size: 0.3, life: 0.4, color: '#9a9fa8' },
  death: {
    voxels: 120, voxel: 0.1, speed: [1.5, 4], up: 2, push: 3, life: [2.5, 3.5],
    puffs: 12, puffSize: [0.3, 0.9], puffLife: 0.6, puffAlpha: 0.45, puffColor: '#d9d2c4',
    flash: 1.2, flashLife: 0.08, helmet: 6, helmetSpin: 4 * Math.PI, color: '#9a9fa8',
  },
  pickup: { cubes: 10, size: 0.05, speed: 2, life: 0.3, ring: 1, band: 0.12 },
};
// Pool sizes; the Low preset uses half of the first four.
const POOLS = { cubes: 1024, sparks: 512, dust: 256, decals: 256, streaks: 256, glows: 64 };
// Map materials by box `color` when the map has no `materials` (bible §2.1),
// and the impact each one makes: plywood is wood, rust is steel, the rest concrete.
const MATERIALS = [
  { name: 'slab', base: '#b7b0a3' }, { name: 'board', base: '#c9c3b8' }, { name: 'precast', base: '#b5afa4' },
  { name: 'plywood', base: '#a38763' }, { name: 'dock', base: '#9d968a' }, { name: 'rust', base: '#8a5a44' },
];
const SURFACE = { plywood: 'wood', rust: 'steel' };

// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const MAX_DT = 0.05; // a long frame, or a tab coming back, steps this much at most
const KILL_Y = -10; // a cube that falls off the world is freed
const WALL_EPS = 0.02; // m: shot ends are rounded to 1 mm on the wire
const PLAYER_MATCH = 0.5; // m: a remote hit can land this far from where we draw the victim
const TRACER = 0;
const BEAM = 1;
const RING = 2;
const BAND = 3;
const PUFF = 4;

export const effectsGroup = new THREE.Group();

// Scratch objects: the hot paths below allocate nothing.
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _u = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _size = new THREE.Vector2();
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

const rand = (r) => r[0] + Math.random() * (r[1] - r[0]);
const put = (arr, i, v) => { arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z; };
const easeOut = (t) => 1 - (1 - Math.min(1, t)) ** 3;

function randomUnit(v) {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * TAU;
  const r = Math.sqrt(1 - z * z);
  return v.set(r * Math.cos(a), z, r * Math.sin(a));
}

// A Color passes through; a string or number is parsed once and kept;
// anything else (an unknown slot or kind) is a neutral grey.
const colors = new Map();
function toColor(c) {
  if (c?.isColor) return c;
  if (c === undefined || c === null) c = LOOK.player.unknown;
  let color = colors.get(c);
  if (!color) colors.set(c, (color = new THREE.Color(c)));
  return color;
}

// Move pool item `from` into slot `to`, for swap-remove: fields are
// [typedArray, itemSize] pairs.
function moveItem(fields, to, from) {
  if (to === from) return;
  for (let f = 0; f < fields.length; f++) {
    const a = fields[f][0];
    const k = fields[f][1];
    a.copyWithin(to * k, from * k, from * k + k);
  }
}

// Upload only the first n items of an attribute.
// One range object per attribute, reused: three clears the list after each upload.
function upload(attr, n) {
  const range = (attr.fxRange ??= { start: 0, count: 0 });
  range.count = Math.max(1, n) * attr.itemSize;
  attr.clearUpdateRanges();
  attr.updateRanges.push(range);
  attr.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// The map: boxes for the physics and the hit classifier, and each box's
// impact surface and chip colour.
let boxes = [];
let surfaces = []; // per box: { kind: 'concrete'|'wood'|'steel', base: Color }
let quality = 'default';
let sunDir = null; // unit [x, y, z] toward the sun, when known: puffs in shade are dimmed
const caps = { ...POOLS };
const cam = { set: false, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1) };

export function initEffects({ boxes: prepared, map, quality: q = 'default', sunDir: sun = null } = {}) {
  boxes = prepared ?? prepareMap(map).boxes;
  sunDir = sun;
  const materials = map?.materials ?? MATERIALS;
  surfaces = (map?.boxes ?? []).map(({ color }) => {
    const mat = materials[color] ?? MATERIALS[color] ?? MATERIALS[0];
    return { kind: SURFACE[mat.name] ?? 'concrete', base: new THREE.Color(mat.base) };
  });
  quality = q === 'low' ? 'low' : 'default';
  const low = quality === 'low';
  for (const k of ['cubes', 'sparks', 'dust', 'decals']) caps[k] = low ? POOLS[k] / 2 : POOLS[k];
  if (typeof location !== 'undefined') {
    const p = new URLSearchParams(location.search);
    if (p.has('debug') && p.has('fx')) debug.scale = Number(p.get('fx')) || 1;
  }
}
// Kept for main.js: the map alone, default quality.
export const setMap = (map) => initEffects({ map });

// Sizes in pixels need the drawing buffer's height, which follows render scale.
const halfHeight = { value: 540 };
function trackViewport(renderer) {
  halfHeight.value = renderer.getDrawingBufferSize(_size).y / 2;
}
const nearFade = { value: new THREE.Vector2(...LOOK.nearFade) };
const clock = { value: 0 }; // effect time in seconds, for decal fades

// ---------------------------------------------------------------------------
// Debris cubes: lit, receiving the sun's shadow, shrinking near the camera.
const cubeMaterial = new THREE.MeshLambertMaterial({ fog: false });
cubeMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uNearFade = nearFade;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec2 uNearFade;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed *= smoothstep(uNearFade.x, uNearFade.y, distance(cameraPosition, (modelMatrix * instanceMatrix[3]).xyz));`);
};
const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cubeMaterial, POOLS.cubes);
cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOLS.cubes * 3), 3).setUsage(THREE.DynamicDrawUsage);
cubes.frustumCulled = false;
cubes.castShadow = false;
cubes.receiveShadow = true;
cubes.count = 0;
const N = POOLS.cubes;
const cube = {
  pos: new Float32Array(N * 3),
  vel: new Float32Array(N * 3),
  rot: new Float32Array(N * 3), // Euler angles, YXZ: flat when x is a half turn and z a quarter
  spin: new Float32Array(N * 3),
  size: new Float32Array(N * 3),
  age: new Float32Array(N),
  life: new Float32Array(N),
  asleep: new Uint8Array(N),
  n: 0, // live cubes: slots 0..n-1
  next: 0, // when full, the slot overwritten next
};
const cubeFields = [[cube.pos, 3], [cube.vel, 3], [cube.rot, 3], [cube.spin, 3], [cube.size, 3], [cube.age, 1], [cube.life, 1], [cube.asleep, 1], [cubes.instanceColor.array, 3]];

// Returns the slot, so a caller can set its spin.
function spawnCube(p, v, s, color, life, spin, tumble, shade = LOOK.cubes.shade) {
  let i;
  if (cube.n < caps.cubes) i = cube.n++;
  else {
    i = cube.next;
    cube.next = (i + 1) % caps.cubes;
  }
  const i3 = i * 3;
  put(cube.pos, i3, p);
  put(cube.vel, i3, v);
  put(cube.size, i3, s);
  for (let a = 0; a < 3; a++) {
    cube.rot[i3 + a] = tumble ? Math.random() * TAU : 0;
    cube.spin[i3 + a] = (Math.random() * 2 - 1) * spin;
  }
  cube.age[i] = 0;
  cube.life[i] = life;
  cube.asleep[i] = 0;
  const k = 1 + (Math.random() * 2 - 1) * shade;
  const col = cubes.instanceColor.array;
  col[i3] = color.r * k;
  col[i3 + 1] = color.g * k;
  col[i3 + 2] = color.b * k;
  return i;
}

// Push a cube out of any map box it has sunk into, through the nearest face,
// and bounce off that face. On a top face it slides to a stop, rolls flat and
// sleeps. f: its shrink factor.
function collide(i, dt, f) {
  const { pos, vel, rot, spin, size } = cube;
  const C = LOOK.cubes;
  const i3 = i * 3;
  const r = Math.min(size[i3], size[i3 + 1], size[i3 + 2]) * 0.5 * f;
  let grounded = false;
  for (let b = 0; b < boxes.length; b++) {
    const { min, max } = boxes[b];
    let axis = -1;
    let out = 0;
    let depth = Infinity;
    for (let a = 0; a < 3; a++) {
      const below = pos[i3 + a] - (min[a] - r);
      const above = max[a] + r - pos[i3 + a];
      if (below <= 0 || above <= 0) { axis = -1; break; }
      if (below < depth) { depth = below; axis = a; out = -1; }
      if (above < depth) { depth = above; axis = a; out = 1; }
    }
    if (axis < 0) continue;
    const j = i3 + axis;
    pos[j] += out * depth;
    if (vel[j] * out < 0) {
      vel[j] = vel[j] * out < -C.minBounce ? -vel[j] * C.restitution : 0;
      for (let a = 0; a < 3; a++) {
        if (a !== axis) vel[i3 + a] *= C.slide;
        spin[i3 + a] *= C.slide;
      }
    }
    if (axis === 1 && out === 1) grounded = true;
  }
  if (!grounded) return;
  const k = Math.exp(-C.groundDrag * dt);
  vel[i3] *= k;
  vel[i3 + 2] *= k;
  for (let a = 0; a < 3; a++) spin[i3 + a] *= k;
  // Roll toward lying on a face. Half turns on x keep a long casing lying down.
  const s = Math.min(1, C.settle * dt);
  const flatX = Math.round(rot[i3] / Math.PI) * Math.PI;
  const flatZ = Math.round(rot[i3 + 2] / HALF_PI) * HALF_PI;
  rot[i3] += (flatX - rot[i3]) * s;
  rot[i3 + 2] += (flatZ - rot[i3 + 2]) * s;
  if (vel[i3] ** 2 + vel[i3 + 1] ** 2 + vel[i3 + 2] ** 2 < 0.0025) {
    cube.asleep[i] = 1;
    rot[i3] = flatX;
    rot[i3 + 2] = flatZ;
    pos[i3 + 1] += (r / f) * (1 - f); // rest at full size: updateCubes sinks it as it shrinks
  }
}

function updateCubes(dt) {
  const { pos, vel, rot, spin, size, age, life, asleep } = cube;
  const mats = cubes.instanceMatrix.array;
  for (let i = 0; i < cube.n;) {
    const i3 = i * 3;
    age[i] += dt;
    if (age[i] >= life[i] || pos[i3 + 1] < KILL_Y) {
      moveItem(cubeFields, i, --cube.n); // the last live cube takes this slot, and is stepped next
      continue;
    }
    // Shrink over the last LOOK.cubes.shrink seconds, or the last half of a short life.
    const f = Math.min(1, (life[i] - age[i]) / Math.min(LOOK.cubes.shrink, life[i] * 0.5));
    if (!asleep[i]) {
      vel[i3 + 1] -= LOOK.gravity * dt;
      for (let a = 0; a < 3; a++) {
        pos[i3 + a] += vel[i3 + a] * dt;
        rot[i3 + a] += spin[i3 + a] * dt;
      }
      collide(i, dt, f);
    }
    // A resting cube shrinks into the face it lies on, not into the air.
    const sink = asleep[i] ? Math.min(size[i3], size[i3 + 1], size[i3 + 2]) * 0.5 * (1 - f) : 0;
    _p.set(pos[i3], pos[i3 + 1] - sink, pos[i3 + 2]);
    _q.setFromEuler(_e.set(rot[i3], rot[i3 + 1], rot[i3 + 2], 'YXZ'));
    _s.set(size[i3] * f, size[i3 + 1] * f, size[i3 + 2] * f);
    _m.compose(_p, _q, _s).toArray(mats, i * 16);
    i++;
  }
  if (cube.n === 0) cube.next = 0;
  cubes.count = cube.n;
  cubes.visible = cube.n > 0;
  if (cube.n) {
    upload(cubes.instanceMatrix, cube.n);
    upload(cubes.instanceColor, cube.n);
  }
}

// ---------------------------------------------------------------------------
// Sparks and dust: points sized in metres (or pixels at 1080p, when
// negative). Style 0 is a soft dust disc; 1 a spark with a hot core, the
// rim colour and a dark edge, streaked back along its velocity on screen
// (the sprite grows to hold the streak); 2 a hexagon with a dark edge.
const POINTS_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aStyle;
attribute vec4 aColor;
attribute vec3 aVel;
uniform float uHalfHeight;
uniform vec2 uNearFade;
varying vec4 vColor;
varying float vStyle;
varying vec4 vStreak; // unit screen direction tail to head, length and width in px
void main() {
  vColor = aColor;
  vStyle = aStyle;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float px = aSize > 0.0 ? aSize * projectionMatrix[1][1] * uHalfHeight / max(-mvPosition.z, 0.01) : -aSize * uHalfHeight / 540.0;
  vColor.a *= min(1.0, px * px / 2.25) * smoothstep(uNearFade.x, uNearFade.y, length(mvPosition.xyz)); // a tiny point fades rather than shimmers
  float size = aSize != 0.0 ? max(px, 1.5) : 0.0;
  vStreak = vec4(1.0, 0.0, 0.0, size);
  vec4 tail = projectionMatrix * (modelViewMatrix * vec4(position - aVel * ${LOOK.spark.stretch.toFixed(3)}, 1.0));
  if (aStyle > 0.5 && aStyle < 1.5 && size > 0.0 && tail.w > 0.01) {
    vec2 halfPx = vec2(uHalfHeight * projectionMatrix[1][1] / projectionMatrix[0][0], uHalfHeight);
    vec2 d = (gl_Position.xy / gl_Position.w - tail.xy / tail.w) * halfPx;
    float l = min(length(d), ${LOOK.spark.maxPx.toFixed(1)} * uHalfHeight / 540.0);
    if (l > 0.5) {
      vStreak.xyz = vec3(normalize(d), l);
      gl_Position.xy -= vStreak.xy * (0.5 * l) / halfPx * gl_Position.w; // the sprite's centre: halfway down the streak
      size += l;
    }
  }
  gl_PointSize = size;
}`;
const POINTS_FRAGMENT = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform vec3 uHexEdge;
varying vec4 vColor;
varying float vStyle;
varying vec4 vStreak;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  vec3 col = vColor.rgb;
  float a = vColor.a;
  if (vStyle < 0.5) {
    a *= max(0.0, 1.0 - r * r);
    a *= a;
  } else if (vStyle < 1.5) {
    vec2 q = (gl_PointCoord - 0.5) * (vStreak.z + vStreak.w) * vec2(1.0, -1.0); // px from the sprite's centre, y up
    float h = 0.5 * vStreak.z;
    float s = clamp(dot(q, vStreak.xy), -h, h);
    r = length(q - vStreak.xy * s) / (0.5 * vStreak.w); // across the streak: 0 on its line, 1 at its edge
    if (r > 1.0) discard;
    a *= vStreak.z > 0.0 ? mix(0.15, 1.0, (s + h) / vStreak.z) : 1.0; // fading toward the tail
    col = mix(uCore, col, smoothstep(0.2, 0.55, r));
    col = mix(col, uEdge, smoothstep(0.62, 0.9, r));
  } else {
    vec2 q = abs(c);
    float h = max(q.x * 0.866 + q.y * 0.5, q.y);
    if (h > 0.92) discard;
    col = mix(mix(vec3(1.0), col, smoothstep(0.0, 0.4, h)), uHexEdge, smoothstep(0.6, 0.72, h));
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;
const pointsMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uHalfHeight: halfHeight,
    uNearFade: nearFade,
    uCore: { value: new THREE.Color(LOOK.spark.core) },
    uEdge: { value: new THREE.Color(LOOK.spark.edge) },
    uHexEdge: { value: new THREE.Color(LOOK.shield.edge) },
  },
  vertexShader: POINTS_VERTEX,
  fragmentShader: POINTS_FRAGMENT,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});

const POINT_ATTRS = ['position', 'aColor', 'aSize', 'aStyle', 'aVel'];
function makePoints(name, cfg, renderOrder) {
  const size = POOLS[name];
  const geometry = new THREE.BufferGeometry();
  for (const [attr, k] of [[POINT_ATTRS[0], 3], [POINT_ATTRS[1], 4], [POINT_ATTRS[2], 1], [POINT_ATTRS[3], 1], [POINT_ATTRS[4], 3]]) {
    geometry.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(size * k), k).setUsage(THREE.DynamicDrawUsage));
  }
  geometry.setDrawRange(0, 0);
  const points = new THREE.Points(geometry, pointsMaterial);
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  points.onBeforeRender = trackViewport;
  const { attributes: at } = geometry;
  const pool = {
    name, cfg, points,
    pos: at.position.array, color: at.aColor.array, size: at.aSize.array, style: at.aStyle.array,
    vel: at.aVel.array, // drawn too: a spark streaks along it
    age: new Float32Array(size),
    life: new Float32Array(size),
    size0: new Float32Array(size),
    size1: new Float32Array(size),
    alpha: new Float32Array(size),
    n: 0,
    next: 0,
  };
  pool.fields = [[pool.pos, 3], [pool.color, 4], [pool.size, 1], [pool.style, 1], [pool.vel, 3], [pool.age, 1], [pool.life, 1], [pool.size0, 1], [pool.size1, 1], [pool.alpha, 1]];
  return pool;
}
const sparks = makePoints('sparks', { gravity: LOOK.gravity * 0.5, drag: 2, fade: 0.5 }, 2);
const dust = makePoints('dust', { gravity: -0.4, drag: 3.5, fade: 1.5 }, 0);

function spawnPoint(pool, p, v, color, alpha, size0, size1, life, style) {
  let i;
  if (pool.n < caps[pool.name]) i = pool.n++;
  else {
    i = pool.next;
    pool.next = (i + 1) % caps[pool.name];
  }
  put(pool.pos, i * 3, p);
  put(pool.vel, i * 3, v);
  pool.color[i * 4] = color.r;
  pool.color[i * 4 + 1] = color.g;
  pool.color[i * 4 + 2] = color.b;
  pool.color[i * 4 + 3] = alpha;
  pool.alpha[i] = alpha;
  pool.size[i] = size0;
  pool.size0[i] = size0;
  pool.size1[i] = size1;
  pool.style[i] = style;
  pool.age[i] = -1; // not drawn yet
  pool.life[i] = life;
  return i;
}

function updatePoints(pool, dt) {
  const { cfg, pos, vel, color, size, age, life, size0, size1, alpha } = pool;
  const drag = Math.exp(-cfg.drag * dt);
  for (let i = 0; i < pool.n;) {
    age[i] = age[i] < 0 ? 0 : age[i] + dt; // a new point is drawn once, however slow the frame
    if (age[i] >= life[i]) {
      moveItem(pool.fields, i, --pool.n);
      continue;
    }
    const i3 = i * 3;
    const t = age[i] / life[i];
    vel[i3 + 1] -= cfg.gravity * dt;
    for (let a = 0; a < 3; a++) {
      vel[i3 + a] *= drag;
      pos[i3 + a] += vel[i3 + a] * dt;
    }
    size[i] = size0[i] + (size1[i] - size0[i]) * easeOut(t);
    color[i * 4 + 3] = alpha[i] * (1 - t) ** cfg.fade;
    i++;
  }
  if (pool.n === 0) pool.next = 0;
  const { geometry } = pool.points;
  geometry.setDrawRange(0, pool.n);
  pool.points.visible = pool.n > 0;
  if (pool.n) for (let k = 0; k < POINT_ATTRS.length; k++) upload(geometry.attributes[POINT_ATTRS[k]], pool.n);
}

// ---------------------------------------------------------------------------
// Decals: bullet holes and scorches, lit like the face they sit on (Lambert,
// receiving the sun's shadow), so a light halo never glows in the shade. A
// ragged dark core over a halo; a decal with a life fades out at its end.
const decalGeometry = new THREE.PlaneGeometry(1, 1);
const decalHalo = new THREE.InstancedBufferAttribute(new Float32Array(POOLS.decals * 4), 4); // halo rgb, halo alpha
const decalShape = new THREE.InstancedBufferAttribute(new Float32Array(POOLS.decals * 4), 4); // core share, core alpha, born, life (0: until recycled)
decalGeometry.setAttribute('aHalo', decalHalo);
decalGeometry.setAttribute('aShape', decalShape);
const decalMaterial = new THREE.MeshLambertMaterial({
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
});
decalMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = clock;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec4 aHalo;\nattribute vec4 aShape;\nvarying vec4 vHalo;\nvarying vec4 vShape;\nvarying vec2 vDecal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHalo = aHalo;\nvShape = aShape;\nvDecal = uv * 2.0 - 1.0;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec4 vHalo;\nvarying vec4 vShape;\nvarying vec2 vDecal;')
    .replace('#include <color_fragment>', `#include <color_fragment>
  float ang = atan(vDecal.y, vDecal.x + 1e-6);
  float seed = vShape.z * 7.13;
  float rr = length(vDecal) * (1.0 + 0.1 * sin(ang * 5.0 + seed) + 0.06 * sin(ang * 3.0 + seed * 1.7));
  float core = (1.0 - smoothstep(vShape.x * 0.65, vShape.x, rr)) * vShape.y;
  float halo = (1.0 - smoothstep(vShape.x, 1.0, rr)) * vHalo.a;
  float cover = core + halo * (1.0 - core);
  if (cover < 0.01) discard;
  diffuseColor.rgb = (diffuseColor.rgb * core + vHalo.rgb * halo * (1.0 - core)) / cover;
  diffuseColor.a = cover * (vShape.w > 0.0 ? 1.0 - smoothstep(vShape.w * 0.75, vShape.w, uTime - vShape.z) : 1.0);`);
};
const decals = new THREE.InstancedMesh(decalGeometry, decalMaterial, POOLS.decals);
decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOLS.decals * 3), 3);
decals.frustumCulled = false;
decals.castShadow = false;
decals.receiveShadow = true;
decals.renderOrder = -1; // first of the blended pools, under dust, streaks and sparks
decals.count = 0;
let decalNext = 0;

// A decal of `size` at `point` on the face with unit `normal`. Given the
// box, it shrinks to stay on the face near an edge, or is skipped right at one.
function spawnDecal(point, normal, size, core, halo, shape, box, life = 0) {
  if (box) {
    const ax = Math.abs(normal[0]);
    const ay = Math.abs(normal[1]);
    const az = Math.abs(normal[2]);
    const axis = ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2);
    let room = Infinity;
    for (let a = 0; a < 3; a++) if (a !== axis) room = Math.min(room, point[a] - box.min[a], box.max[a] - point[a]);
    if (2 * room < size * LOOK.decal.minFit) return;
    size = Math.min(size, 2 * room);
  }
  _z.fromArray(normal);
  const flat = Math.abs(_z.y) > 0.9;
  _x.set(flat ? 1 : 0, flat ? 0 : 1, 0).cross(_z).normalize(); // along the face
  _y.crossVectors(_z, _x);
  const turn = Math.random() * TAU; // turned at random, so the ragged edges differ
  _u.copy(_x).multiplyScalar(Math.cos(turn)).addScaledVector(_y, Math.sin(turn));
  _y.crossVectors(_z, _u);
  _m.makeBasis(_u, _y, _z).scale(_s.set(size, size, 1));
  const lift = LOOK.decal.lift;
  _m.setPosition(point[0] + _z.x * lift, point[1] + _z.y * lift, point[2] + _z.z * lift);
  const i = decalNext;
  _m.toArray(decals.instanceMatrix.array, i * 16);
  decals.instanceColor.setXYZ(i, core.r, core.g, core.b);
  decalHalo.setXYZW(i, halo.r, halo.g, halo.b, shape[2]);
  decalShape.setXYZW(i, shape[0], shape[1], clock.value, life);
  decals.instanceMatrix.needsUpdate = decals.instanceColor.needsUpdate = decalHalo.needsUpdate = decalShape.needsUpdate = true;
  decalNext = (decalNext + 1) % caps.decals;
  decals.count = Math.min(decals.count + 1, caps.decals);
  }

// ---------------------------------------------------------------------------
// Streaks: one quad per instance, normal-blended, in five styles:
//   TRACER, BEAM: a ribbon from aA to aB facing the camera, aA.w wide plus
//     aB.w per metre from the camera; a light core, the body colour, a dark
//     fringe. A beam zigzags aD.y either side of its line.
//   RING: an annulus lying flat, centre aA.xyz, outer radius aA.w, band aD.y.
//   BAND: an upright quad, centre aA.xyz, half height aA.w, half width aB.xyz.
//   PUFF: a soft lumpy disc facing the camera, centre aA.xyz, aA.w across.
// aC is the body colour and alpha; aD.x the style.
const STREAK_VERTEX = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
attribute vec4 aC;
attribute vec4 aD;
uniform vec2 uNearFade;
uniform float uHalfHeight;
uniform float uMinPixels;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParam;
varying vec2 vMetres; // ribbons: metres along, full width; rings: outer radius, band
void main() {
  int style = int(aD.x + 0.5);
  vUv = position.xy;
  vColor = aC;
  vParam = aD;
  vec3 p;
  if (style <= 1) {
    vec3 a = aA.xyz;
    vec3 b = aB.xyz;
    p = mix(a, b, position.x);
    vec3 side = cross(b - a, p - cameraPosition);
    float l = length(side);
    side = l > 0.0 ? side / l : vec3(0.0);
    float dist = length(p - cameraPosition);
    float w = aA.w + aB.w * dist;
    float minW = uMinPixels * max(-(viewMatrix * vec4(p, 1.0)).z, 0.01) / (projectionMatrix[1][1] * uHalfHeight);
    vColor.a *= sqrt(min(1.0, w / minW)) * smoothstep(uNearFade.x, uNearFade.y, dist); // thinner than uMinPixels: wider, a little fainter, never broken up
    w = max(w, minW) + 2.0 * aD.y;
    p += side * position.y * w * 0.5;
    vMetres = vec2(position.x * length(b - a), w);
  } else if (style == 2) {
    float r = aA.w;
    p = aA.xyz + vec3((position.x * 2.0 - 1.0) * r, 0.0, position.y * r);
    vMetres = vec2(r, aD.y);
  } else if (style == 3) {
    p = aA.xyz + aB.xyz * (position.x * 2.0 - 1.0) + vec3(0.0, position.y * aA.w, 0.0);
  } else {
    vec4 mv = viewMatrix * vec4(aA.xyz, 1.0);
    float c = cos(aD.y);
    float s = sin(aD.y);
    vec2 q = vec2(position.x * 2.0 - 1.0, position.y) * aA.w * 0.5;
    mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    vColor.a *= smoothstep(uNearFade.x, uNearFade.y, length(mv.xyz));
    gl_Position = projectionMatrix * mv;
    return;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const STREAK_FRAGMENT = /* glsl */ `
uniform vec3 uTracerCore;
uniform vec3 uTracerFringe;
uniform vec3 uBeamCore;
uniform vec3 uDark;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParam;
varying vec2 vMetres;
// Across a ribbon or band, 0 at its centre line and 1 at its edge: a light
// core, the body, then a dark fringe.
vec4 profile(float d, vec3 core, vec3 body, vec3 fringe, float fringeAlpha) {
  vec3 col = mix(core, body, smoothstep(0.22, 0.42, d));
  col = mix(col, fringe, smoothstep(0.55, 0.7, d));
  float a = mix(1.0, fringeAlpha, smoothstep(0.55, 0.7, d)) * (1.0 - smoothstep(0.85, 1.0, d));
  return vec4(col, a);
}
void main() {
  int style = int(vParam.x + 0.5);
  vec4 o;
  if (style == 0) {
    float u = vUv.x; // 0 tail, 1 head
    o = profile(abs(vUv.y), uTracerCore, mix(vColor.rgb, uTracerCore, u * u), uTracerFringe, ${LOOK.tracer.fringeAlpha.toFixed(2)});
    o.a *= u;
  } else if (style == 1) {
    float x = vMetres.x / 0.5 + vParam.z;
    float zig = vParam.y * (1.0 - 2.0 * abs(fract(x * 0.5) * 2.0 - 1.0));
    float half_ = max(0.5 * vMetres.y - vParam.y, 1e-4);
    float d = abs(vUv.y * 0.5 * vMetres.y - zig) / half_;
    if (d > 1.0) discard;
    o = profile(d, vParam.w > 0.5 ? vec3(1.0) : uBeamCore, vColor.rgb, uDark, ${LOOK.bolt.fringeAlpha.toFixed(2)});
  } else if (style == 2) {
    float r = length(vec2(vUv.x * 2.0 - 1.0, vUv.y)) * vMetres.x;
    float t = (vMetres.x - r) / max(vMetres.y, 1e-4); // 0 on the leading edge, 1 on the inner
    if (t < 0.0 || t > 1.0) discard;
    vec3 col = mix(vec3(1.0), vColor.rgb, smoothstep(0.0, 0.35, t));
    col = mix(col, uDark, smoothstep(0.75, 0.95, t) * 0.6);
    o = vec4(col, 1.0 - smoothstep(0.85, 1.0, t));
  } else if (style == 3) {
    float v = vUv.y; // -1 floor, 1 top
    vec3 col = mix(vColor.rgb, vec3(1.0), smoothstep(0.55, 0.8, v));
    col = mix(col, uDark, smoothstep(0.88, 0.97, v));
    o = vec4(col, (0.45 + 0.55 * smoothstep(-1.0, 0.4, v)) * (1.0 - smoothstep(0.95, 1.0, v)));
  } else {
    vec2 c = vec2(vUv.x * 2.0 - 1.0, vUv.y);
    float ang = atan(c.y, c.x);
    float r = length(c) * (1.0 + 0.12 * sin(ang * 5.0 + vParam.y * 3.0) + 0.07 * sin(ang * 9.0 - vParam.y));
    float a = 1.0 - smoothstep(0.45, 1.0, r);
    o = vec4(vColor.rgb * (0.9 + 0.2 * (1.0 - r)), a);
  }
  o.a *= vColor.a;
  if (o.a < 0.003) discard;
  gl_FragColor = o;
  #include <colorspace_fragment>
}`;
const STREAK_ATTRS = ['aA', 'aB', 'aC', 'aD'];
const GLOW_ATTRS = ['aA', 'aC', 'aD'];
const quadGeometry = (count) => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const name of ['aA', 'aB', 'aC', 'aD']) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  return g;
};
const streakGeometry = quadGeometry(POOLS.streaks);
const streaks = new THREE.Mesh(streakGeometry, new THREE.ShaderMaterial({
  uniforms: {
    uNearFade: nearFade,
    uHalfHeight: halfHeight,
    uMinPixels: { value: 2.5 },
    uTracerCore: { value: new THREE.Color(LOOK.tracer.core) },
    uTracerFringe: { value: new THREE.Color(LOOK.tracer.fringe) },
    uBeamCore: { value: new THREE.Color(LOOK.bolt.core) },
    uDark: { value: new THREE.Color(LOOK.bolt.fringe) },
  },
  vertexShader: STREAK_VERTEX,
  fragmentShader: STREAK_FRAGMENT,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
}));
streaks.frustumCulled = false;
streaks.renderOrder = 1;
streaks.onBeforeRender = trackViewport;
// Per streak on the CPU. p: start or centre; d: unit direction, or a band's
// [cos, 0, sin] of its middle angle, or a puff's drift; len: a tracer's or
// beam's length, a ring's or band's final radius, a puff's burning share of
// its life (0: not burning); a/b: style-specific.
const S = POOLS.streaks;
const streak = {
  kind: new Float32Array(S),
  age: new Float32Array(S),
  life: new Float32Array(S),
  p: new Float32Array(S * 3),
  d: new Float32Array(S * 3),
  len: new Float32Array(S),
  a: new Float32Array(S),
  b: new Float32Array(S),
  col: new Float32Array(S * 4),
  seed: new Float32Array(S),
  n: 0,
  next: 0,
};
const FIRE = new THREE.Color(LOOK.blast.fireColor);
const streakFields = [[streak.kind, 1], [streak.age, 1], [streak.life, 1], [streak.p, 3], [streak.d, 3], [streak.len, 1], [streak.a, 1], [streak.b, 1], [streak.col, 4], [streak.seed, 1]];

function spawnStreak(kind, p, d, len, a, b, color, alpha, life, seed = 0) {
  let i;
  if (streak.n < caps.streaks) i = streak.n++;
  else {
    i = streak.next;
    streak.next = (i + 1) % caps.streaks;
  }
  streak.kind[i] = kind;
  streak.age[i] = -1; // drawn once where it starts, however slow the frame
  streak.life[i] = life;
  put(streak.p, i * 3, p);
  put(streak.d, i * 3, d);
  streak.len[i] = len;
  streak.a[i] = a;
  streak.b[i] = b;
  streak.col[i * 4] = color.r;
  streak.col[i * 4 + 1] = color.g;
  streak.col[i * 4 + 2] = color.b;
  streak.col[i * 4 + 3] = alpha;
  streak.seed[i] = seed;
}

// A spark: a point flying at `v` (m/s, a Vector3), `px` wide at 1080p, streaked along its flight.
function spawnSpark(p, v, color, life, px) {
  const i = spawnPoint(sparks, p, v, color, 1, -px, -px, life, 1) * 3;
  for (let a = 0; a < 3; a++) sparks.pos[i + a] += sparks.vel[i + a] * LOOK.spark.stretch; // born one streak out, so its tail starts at `p`
}

// `color` as an unlit puff at `p` shows it: dimmed to skylight when a map box
// stands between it and the sun, or it sits on a face turned away from it.
// Returns a shared Color, valid until the next call.
const _lit = new THREE.Color();
const _o = [0, 0, 0];
function lit(color, p, normal) {
  _lit.copy(color);
  if (!sunDir) return _lit;
  let shade = normal && normal[0] * sunDir[0] + normal[1] * sunDir[1] + normal[2] * sunDir[2] < 0;
  for (let a = 0; a < 3; a++) _o[a] = p.getComponent(a) + sunDir[a] * 0.05;
  for (let b = 0; b < boxes.length && !shade; b++) shade = rayBox(_o, sunDir, boxes[b].min, boxes[b].max) < Infinity;
  if (shade) _lit.r *= LOOK.shade[0], _lit.g *= LOOK.shade[1], _lit.b *= LOOK.shade[2];
  return _lit;
}

function updateStreaks(dt) {
  const at = streakGeometry.attributes;
  const A = at.aA.array;
  const B = at.aB.array;
  const C = at.aC.array;
  const D = at.aD.array;
  const { kind, age, life, p, d, len, a, b, col, seed } = streak;
  for (let i = 0; i < streak.n;) {
    age[i] = age[i] < 0 ? 0 : age[i] + dt;
    const k = kind[i];
    const i3 = i * 3;
    const i4 = i * 4;
    // A tracer lives until its tail reaches the impact; the rest by the clock.
    const t = k === TRACER ? (age[i] * LOOK.tracer.speed) / len[i] : age[i] / life[i];
    if (t >= 1) {
      moveItem(streakFields, i, --streak.n);
      continue;
    }
    let alpha = col[i4 + 3];
    D[i4] = k;
    D[i4 + 1] = D[i4 + 2] = D[i4 + 3] = 0;
    if (k === TRACER) {
      const back = age[i] * LOOK.tracer.speed;
      const front = Math.min(back + a[i], len[i]); // never past the impact
      for (let j = 0; j < 3; j++) {
        A[i4 + j] = p[i3 + j] + d[i3 + j] * back;
        B[i4 + j] = p[i3 + j] + d[i3 + j] * front;
      }
      A[i4 + 3] = LOOK.tracer.width;
      B[i4 + 3] = LOOK.tracer.widthPerM;
    } else if (k === BEAM) {
      for (let j = 0; j < 3; j++) {
        A[i4 + j] = p[i3 + j];
        B[i4 + j] = p[i3 + j] + d[i3 + j] * len[i];
      }
      A[i4 + 3] = a[i];
      B[i4 + 3] = b[i];
      D[i4 + 1] = seed[i] < 0 ? 0 : LOOK.bolt.zig;
      D[i4 + 2] = Math.random() * 2; // the zigzag crawls every frame
      D[i4 + 3] = seed[i] < 0 ? 1 : 0; // a white core (Shock) or the bolt's
      alpha *= 1 - t * t;
    } else if (k === RING) {
      const grow = easeOut(age[i] / b[i]);
      A[i4] = p[i3];
      A[i4 + 1] = p[i3 + 1];
      A[i4 + 2] = p[i3 + 2];
      A[i4 + 3] = Math.max(0.01, len[i] * grow);
      D[i4 + 1] = Math.min(a[i], A[i4 + 3]);
      alpha *= 1 - Math.max(0, (age[i] - b[i]) / (life[i] - b[i]));
    } else if (k === BAND) {
      const r = len[i] * easeOut(age[i] / b[i]);
      const cx = d[i3];
      const sz = d[i3 + 2];
      const half = r * Math.tan(Math.PI / LOOK.barge.segments);
      A[i4] = p[i3] + cx * r;
      A[i4 + 1] = p[i3 + 1] + a[i] / 2;
      A[i4 + 2] = p[i3 + 2] + sz * r;
      A[i4 + 3] = a[i] / 2;
      B[i4] = -sz * half;
      B[i4 + 1] = 0;
      B[i4 + 2] = cx * half;
      alpha *= 1 - Math.max(0, (age[i] - b[i]) / (life[i] - b[i]));
    } else {
      for (let j = 0; j < 3; j++) p[i3 + j] += d[i3 + j] * dt;
      A[i4] = p[i3];
      A[i4 + 1] = p[i3 + 1];
      A[i4 + 2] = p[i3 + 2];
      A[i4 + 3] = a[i] + (b[i] - a[i]) * easeOut(t);
      D[i4 + 1] = seed[i];
      alpha *= (1 - t) ** 1.5;
    }
    C[i4] = col[i4];
    C[i4 + 1] = col[i4 + 1];
    C[i4 + 2] = col[i4 + 2];
    C[i4 + 3] = alpha;
    if (k === PUFF && len[i] > 0) { // a burning puff: fire cooling to its smoke colour over `len` of its life
      const h = Math.min(1, t / len[i]);
      C[i4] = FIRE.r + (col[i4] - FIRE.r) * h;
      C[i4 + 1] = FIRE.g + (col[i4 + 1] - FIRE.g) * h;
      C[i4 + 2] = FIRE.b + (col[i4 + 2] - FIRE.b) * h;
    }
    i++;
  }
  if (streak.n === 0) streak.next = 0;
  streakGeometry.instanceCount = streak.n;
  streaks.visible = streak.n > 0;
  if (streak.n) for (let k = 0; k < STREAK_ATTRS.length; k++) upload(at[STREAK_ATTRS[k]], streak.n);
}

// ---------------------------------------------------------------------------
// Glows: additive camera-facing quads, round or a four-point star, warming
// toward orange at the edge. The only additive pool: muzzle flashes and blasts.
const GLOW_VERTEX = /* glsl */ `
attribute vec4 aA; // centre, size
attribute vec4 aC; // colour, alpha
attribute vec4 aD; // star, roll, warm
uniform vec2 uNearFade;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParam;
void main() {
  vUv = vec2(position.x * 2.0 - 1.0, position.y);
  vColor = aC;
  vParam = aD;
  vec4 mv = viewMatrix * vec4(aA.xyz, 1.0);
  float c = cos(aD.y);
  float s = sin(aD.y);
  vec2 q = vUv * aA.w * 0.5;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vColor.a *= smoothstep(uNearFade.x, uNearFade.y, length(mv.xyz));
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParam;
void main() {
  float r = length(vUv);
  float a;
  if (vParam.x > 0.5) {
    vec2 q = abs(vUv);
    a = max(max(0.0, 1.0 - q.x * 1.1) * max(0.0, 1.0 - q.y * 7.0), max(0.0, 1.0 - q.y * 1.1) * max(0.0, 1.0 - q.x * 7.0));
    a = max(a, (1.0 - smoothstep(0.0, 0.45, r)) * 0.8);
  } else {
    a = pow(max(0.0, 1.0 - r), 1.5);
  }
  vec3 edge = vColor.rgb * mix(vec3(1.0), vec3(1.0, 0.39, 0.24), vParam.z);
  vec3 col = mix(edge, vColor.rgb, smoothstep(0.15, 0.7, a));
  a *= vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;
const glowGeometry = quadGeometry(POOLS.glows);
const glows = new THREE.Mesh(glowGeometry, new THREE.ShaderMaterial({
  uniforms: { uNearFade: nearFade },
  vertexShader: GLOW_VERTEX,
  fragmentShader: GLOW_FRAGMENT,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
}));
glows.frustumCulled = false;
glows.renderOrder = 3;
const G = POOLS.glows;
const glow = {
  p: new Float32Array(G * 3),
  size0: new Float32Array(G),
  size1: new Float32Array(G),
  age: new Float32Array(G),
  life: new Float32Array(G),
  col: new Float32Array(G * 4),
  par: new Float32Array(G * 4), // star, roll, warm, -
  n: 0,
  next: 0,
};
const glowFields = [[glow.p, 3], [glow.size0, 1], [glow.size1, 1], [glow.age, 1], [glow.life, 1], [glow.col, 4], [glow.par, 4]];

function spawnGlow(p, size0, size1, color, alpha, life, star, warm) {
  let i;
  if (glow.n < caps.glows) i = glow.n++;
  else {
    i = glow.next;
    glow.next = (i + 1) % caps.glows;
  }
  put(glow.p, i * 3, p);
  glow.size0[i] = size0;
  glow.size1[i] = size1;
  glow.age[i] = -1;
  glow.life[i] = life;
  glow.col[i * 4] = color.r;
  glow.col[i * 4 + 1] = color.g;
  glow.col[i * 4 + 2] = color.b;
  glow.col[i * 4 + 3] = alpha;
  glow.par[i * 4] = star ? 1 : 0;
  glow.par[i * 4 + 1] = Math.random() * TAU;
  glow.par[i * 4 + 2] = warm ? 1 : 0;
}

function updateGlows(dt) {
  const at = glowGeometry.attributes;
  const A = at.aA.array;
  const C = at.aC.array;
  const D = at.aD.array;
  for (let i = 0; i < glow.n;) {
    glow.age[i] = glow.age[i] < 0 ? 0 : glow.age[i] + dt;
    const t = glow.age[i] / glow.life[i];
    if (t >= 1) {
      moveItem(glowFields, i, --glow.n);
      continue;
    }
    const i4 = i * 4;
    A[i4] = glow.p[i * 3];
    A[i4 + 1] = glow.p[i * 3 + 1];
    A[i4 + 2] = glow.p[i * 3 + 2];
    A[i4 + 3] = glow.size0[i] + (glow.size1[i] - glow.size0[i]) * easeOut(t);
    for (let j = 0; j < 3; j++) C[i4 + j] = glow.col[i4 + j];
    C[i4 + 3] = glow.col[i4 + 3] * (1 - t) ** 2;
    for (let j = 0; j < 4; j++) D[i4 + j] = glow.par[i4 + j];
    i++;
  }
  if (glow.n === 0) glow.next = 0;
  glowGeometry.instanceCount = glow.n;
  glows.visible = glow.n > 0;
  if (glow.n) for (let k = 0; k < GLOW_ATTRS.length; k++) upload(at[GLOW_ATTRS[k]], glow.n);
}

effectsGroup.add(cubes, decals, dust.points, streaks, sparks.points, glows);
// For tests and debugging.
export const pools = { cubes, decals, dust: dust.points, sparks: sparks.points, streaks, glows };

// ---------------------------------------------------------------------------
// The API. Points and directions are [x, y, z] arrays; colours are Colors,
// numbers or CSS strings (a string is parsed once, then cached).

// What a shot that ran from `origin` (the eye) to `end` hit, worked out from
// the map and the players ({ id, x, y, z, crouch }, as others() gives them):
//   kind 'wall': normal is the outward unit normal of the face it entered,
//     surface the map box's index (pass both to impact());
//   kind 'player': id and head from the nearest hitboxes(), id null if none
//     is near enough (the server hit them where the shooter saw them);
//   kind 'none': it flew out to SHOT_RANGE.
// dir is the shot's unit direction. The result is one shared object, valid
// until the next call.
const HIT = { kind: 'none', normal: [0, 0, 0], dir: [0, 0, 0], surface: -1, id: null, head: false, target: null };
export function classifyHit(origin, end, players) {
  const d = HIT.dir;
  const len = Math.hypot(end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]) || 1;
  for (let a = 0; a < 3; a++) d[a] = (end[a] - origin[a]) / len;
  HIT.kind = 'none';
  HIT.surface = -1;
  HIT.id = null;
  HIT.head = false;
  HIT.target = null;
  // The box face the ray enters first: the slab it enters last gives the axis.
  let best = Infinity;
  let bestAxis = -1;
  for (let b = 0; b < boxes.length; b++) {
    const { min, max } = boxes[b];
    let near = 0;
    let far = Infinity;
    let axis = -1;
    for (let a = 0; a < 3 && near <= far; a++) {
      if (d[a] === 0) {
        if (origin[a] < min[a] || origin[a] > max[a]) near = Infinity;
        continue;
      }
      const t1 = (min[a] - origin[a]) / d[a];
      const t2 = (max[a] - origin[a]) / d[a];
      if (Math.min(t1, t2) > near) { near = Math.min(t1, t2); axis = a; }
      far = Math.min(far, Math.max(t1, t2));
    }
    if (axis >= 0 && near <= far && near < best) {
      best = near;
      bestAxis = axis;
      HIT.surface = b;
    }
  }
  if (Math.abs(best - len) < WALL_EPS) {
    HIT.kind = 'wall';
    HIT.normal.fill(0);
    HIT.normal[bestAxis] = d[bestAxis] > 0 ? -1 : 1;
    return HIT;
  }
  HIT.surface = -1;
  if (len > SHOT_RANGE - WALL_EPS) return HIT;
  HIT.kind = 'player';
  let nearest = PLAYER_MATCH;
  for (const p of players) {
    const { head, body } = hitboxes(p);
    const toHead = boxDistance(end, head);
    const toBody = boxDistance(end, body);
    if (Math.min(toHead, toBody) < nearest) {
      nearest = Math.min(toHead, toBody);
      HIT.id = p.id;
      HIT.head = toHead < toBody;
      HIT.target = p;
    }
  }
  return HIT;
}

function boxDistance(p, { min, max }) {
  let sq = 0;
  for (let a = 0; a < 3; a++) sq += Math.max(min[a] - p[a], 0, p[a] - max[a]) ** 2;
  return Math.sqrt(sq);
}

// Per shot event: debris cubes and puffs left to spend (Infinity outside shot()).
const budget = { chips: Infinity, puffs: Infinity };

// A bullet hitting the map at `point`, on the face with outward unit `normal`:
// chips, splinters or sparks by the face's material, a puff on concrete, and
// a hole. surface: the map box index classifyHit gives. weapon: 'rifle',
// 'pistol', 'pellet' (one shotgun pellet) or 'bolt'.
export function impact(point, normal, surface, weapon = 'rifle') {
  const s = surfaces[surface] ?? { kind: 'concrete', base: toColor(MATERIALS[0].base) };
  const n = _u.fromArray(normal);
  const w = weapon === 'shotgun' ? 'pellet' : weapon;
  if (s.kind === 'steel' || w === 'bolt') {
    const L = LOOK.steel;
    const rim = w === 'bolt' ? toColor(LOOK.bolt.body) : toColor(L.color);
    for (let k = w === 'bolt' ? LOOK.bolt.sparks : L.sparks; k > 0; k--) {
      randomUnit(_v).multiplyScalar(0.7).add(n).normalize().multiplyScalar(rand(L.speed));
      spawnSpark(_p.fromArray(point).addScaledVector(n, 0.01), _v, rim, L.life * (0.6 + Math.random() * 0.8), L.px);
    }
  }
  if (s.kind === 'wood') {
    const L = LOOK.wood;
    for (let k = Math.min(L.chips, budget.chips); k > 0; k--, budget.chips--) {
      _p.fromArray(point).addScaledVector(n, 0.03);
      randomUnit(_v).multiplyScalar(1.2).addScaledVector(n, rand(L.speed));
      spawnCube(_p, _v, _s.fromArray(L.size), toColor(L.color), rand(L.life), 18, true);
    }
  } else if (s.kind === 'concrete') {
    const L = LOOK.concrete;
    for (let k = Math.min(L.chips[w] ?? L.chips.rifle, budget.chips); k > 0; k--, budget.chips--) {
      const size = rand(L.size);
      _p.fromArray(point).addScaledVector(n, size); // off the face, so the push-out can't sink it
      randomUnit(_v).multiplyScalar(1.2).addScaledVector(n, rand(L.speed));
      _v.y += 0.8;
      spawnCube(_p, _v, _s.setScalar(size), s.base, rand(L.life), 14, true);
    }
    if (budget.puffs > 0) {
      budget.puffs--;
      _p.fromArray(point).addScaledVector(n, 0.08);
      spawnPoint(dust, _p, _v.copy(n).multiplyScalar(0.6), lit(toColor(L.puff), _p, normal), L.puffAlpha, L.puffSize[0], L.puffSize[1], L.puffLife, 0);
    }
  }
  const look = LOOK[s.kind];
  spawnDecal(point, normal, LOOK.decal.size[w] ?? LOOK.decal.size.rifle, toColor(look.decal[0]), toColor(look.decal[1]), DECAL_HOLE, boxes[surface]);
}
const DECAL_HOLE = [LOOK.decal.core, 1, LOOK.decal.halo];

// A bullet hitting a player at `point`, flying along unit `dir`: cubes in
// their `color` and one white one burst out, mostly along the shot.
export function playerHit(point, dir, color, head) {
  const L = LOOK.player;
  const c = toColor(color);
  const n = Math.min(head ? L.headCubes : L.cubes, budget.chips);
  for (let k = 0; k <= n && budget.chips > 0; k++, budget.chips--) {
    randomUnit(_v).multiplyScalar(rand(L.speed) * 0.6).addScaledVector(_u.fromArray(dir), rand(L.speed) * (Math.random() * 1.2 - 0.2));
    _v.y += 1;
    spawnCube(_p.fromArray(point), _v, _s.setScalar(rand(L.size)), k === n ? WHITE : c, L.life * (0.8 + Math.random() * 0.4), 12, true);
  }
}

// A bullet stopped by a power-up Shield: hexagon sparks bounce back off it.
export function shieldHit(point, dir) {
  const L = LOOK.shield;
  const c = toColor(L.color);
  for (let k = 0; k < L.sparks; k++) {
    randomUnit(_v).addScaledVector(_u.fromArray(dir), -1.2).normalize().multiplyScalar(rand(L.speed));
    spawnPoint(sparks, _p.fromArray(point), _v, c, 1, L.size, L.size * 0.6, L.life, 2);
  }
}

// A shot event: tracers (or Bolt beams) from `from`, the drawn muzzle, to
// each end, and what each end hit, classified from `eye` (where the shot was
// traced; defaults to `from`). targets: players as others() gives them, plus
// `color` and `bubble` (or the BUBBLE flag); a hit on nobody we know near
// the camera is on us, and shows nothing. At most LOOK.caps chips and puffs
// per call, however many pellets.
export function shot({ from, eye = from, ends, weapon = 'rifle', targets = [] }) {
  const w = weapon === 'bolt' ? 'bolt' : ends.length > 1 ? 'pellet' : weapon;
  budget.chips = LOOK.caps.chips;
  budget.puffs = LOOK.caps.puffs;
  for (const end of ends) {
    if (w === 'bolt') beam(from, end);
    else addTracer(from, end, w);
    const hit = classifyHit(eye, end, targets);
    if (hit.kind === 'wall') impact(end, hit.normal, hit.surface, w);
    else if (hit.kind === 'player' && !(hit.id === null && cam.set && cam.pos.distanceTo(_p.fromArray(end)) < 1.8)) { // not our own body
      const t = hit.target;
      if (t && (t.bubble || t.flags & PLAYER_FLAGS.BUBBLE)) shieldHit(end, hit.dir);
      else playerHit(end, hit.dir, t?.color, hit.head);
    }
  }
  budget.chips = budget.puffs = Infinity;
}

// A tracer streak from `from` (the muzzle) to `to` (where the shot ended),
// flying at bullet speed. weapon picks its length.
export function addTracer(from, to, weapon = 'rifle') {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (dist < 0.01) return;
  _v.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]).divideScalar(dist);
  spawnStreak(TRACER, _p.fromArray(from), _v, dist, LOOK.tracer.length[weapon] ?? LOOK.tracer.length.rifle, 0, toColor(LOOK.tracer.tail), 1, 1);
}

// A Bolt: an instant zigzag beam from `from` to `to`, gone in 140 ms.
export function beam(from, to) {
  const L = LOOK.bolt;
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (dist < 0.01) return;
  _v.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]).divideScalar(dist);
  spawnStreak(BEAM, _p.fromArray(from), _v, dist, L.width, L.widthPerM, toColor(L.body), 1, L.life, Math.random());
}

// Someone else's muzzle flash at `pos`, the gun pointing along `dir`.
export function muzzle(pos, dir) {
  const L = LOOK.muzzle;
  const c = toColor(L.color);
  _p.fromArray(pos);
  if (dir) _p.addScaledVector(_v.fromArray(dir), 0.05);
  spawnGlow(_p, L.star, L.star, c, 1, L.life, true, true);
  spawnGlow(_p, L.glow, L.glow, c, 0.6, L.life, false, true);
}

// A spent case thrown from `pos` along unit `dir` (the shooter's right),
// plus `carry`, the shooter's velocity, when given. Only within 15 m of the
// camera, and never on Low.
export function casing(pos, dir, weapon = 'rifle', carry) {
  const L = LOOK.casing;
  if (quality === 'low') return;
  if (cam.set && cam.pos.distanceToSquared(_p.fromArray(pos)) > L.range * L.range) return;
  const look = L[weapon] ?? L.rifle;
  randomUnit(_v).multiplyScalar(L.jitter).addScaledVector(_u.fromArray(dir), L.speed);
  _v.y += L.up;
  if (carry) _v.add(_u.fromArray(carry));
  spawnCube(_p.fromArray(pos), _v, _s.fromArray(look.size), toColor(look.color), L.life, L.spin, true, 0.04);
}

// The top of the map under (x, y, z), at most `reach` m down, or null.
function floorBelow(x, y, z, reach) {
  let top = null;
  for (const { min, max } of boxes) {
    if (x < min[0] || x > max[0] || z < min[2] || z > max[2]) continue;
    if (max[1] <= y + 0.05 && max[1] >= y - reach && (top === null || max[1] > top)) top = max[1];
  }
  return top;
}

// A power-up going off at `pos` (bible §3.3): Shunt and Mine blasts, the
// Barge ring, a Shock strike, or a fizzle when radius is 0. radius defaults
// to the kind's own.
export function blast(kind, pos, radius = POWERS[kind]?.splash ?? POWERS[kind]?.radius ?? 2.5) {
  const hue = toColor(POWER_COLORS[kind] ?? LOOK.blast.glowColor);
  const [x, y, z] = pos;
  if (!radius) return fizzle(pos);
  if (kind === 'bolt') return zap(pos, hue);
  const ground = floorBelow(x, y, z, LOOK.blast.scorchReach);
  if (kind === 'barge') return barge(x, ground ?? y, z, radius, hue);
  if (kind === 'shock') return shock(x, ground ?? y, z, radius, hue);
  const L = LOOK.blast;
  for (let k = 0; k < L.voxels; k++) {
    randomUnit(_v);
    _v.y = Math.abs(_v.y) * 0.8 + 0.3;
    _v.normalize().multiplyScalar(rand(L.speed));
    const c = L.colors[k % 3] ? toColor(L.colors[k % 3]) : hue;
    spawnCube(_p.set(x, y + 0.1, z), _v, _s.setScalar(rand(L.voxelSize)), c, L.life * (0.8 + Math.random() * 0.4), 10, true);
  }
  spawnStreak(RING, _p.set(x, (ground ?? y) + 0.04, z), _v.set(0, 1, 0), radius, L.ringBand, L.grow, hue, 1, L.ringLife);
  spawnGlow(_p.set(x, y + 0.3, z), L.glow[0], L.glow[1], toColor(L.glowColor), 1, L.glowLife, false, true);
  spawnGlow(_p, L.flash[0], L.flash[1], toColor(L.flashColor), 1, L.flashLife, true, true);
  // A fireball of puffs burning out to smoke, then dust rolling up around it.
  for (let k = 0; k < L.puffs; k++) {
    const fire = k < L.fire;
    randomUnit(_u).multiplyScalar(radius * (fire ? 0.2 : 0.4));
    _p.set(x + _u.x, y + 0.3 + Math.abs(_u.y), z + _u.z);
    _v.copy(_u).multiplyScalar(fire ? 3 : 1.5).add(_s.set(0, fire ? 1.2 : 0.8, 0));
    const size = fire ? L.fireSize : L.puffSize;
    spawnStreak(PUFF, _p, _v, fire ? L.fireHeat : 0, rand([size[0], size[0] * 1.3]), size[1], lit(toColor(L.puffColors[k % 2]), _p), fire ? 1 : L.puffAlpha, (fire ? L.fireLife : L.puffLife) * (0.8 + Math.random() * 0.4), Math.random() * TAU);
  }
  if (ground !== null) {
    _c.set(L.scorchColor);
    spawnDecal([x, ground, z], [0, 1, 0], L.scorch, _c, _c, [0.45, L.scorchAlpha, L.scorchAlpha * 0.6], null, L.scorchLife);
  }
}

// Barge: a band racing out across the floor, on a ring of the same width.
function barge(x, y, z, radius, hue) {
  const L = LOOK.barge;
  for (let k = 0; k < L.segments; k++) {
    const angle = ((k + 0.5) / L.segments) * TAU;
    _v.set(Math.cos(angle), 0, Math.sin(angle));
    spawnStreak(BAND, _p.set(x, y, z), _v, radius, L.height, L.grow, hue, 0.9, L.life);
  }
  spawnStreak(RING, _p.set(x, y + 0.03, z), _v.set(0, 1, 0), radius, L.thick, L.grow, hue, 0.8, L.life);
}

// Shock: a beam out of the sky, a ring on the floor, sparks and a hot core.
function shock(x, y, z, radius, hue) {
  const L = LOOK.shock;
  spawnStreak(BEAM, _p.set(x, y, z), _v.set(0, 1, 0), L.beam[0], L.beam[1], 0, hue, 1, L.life, -1);
  spawnStreak(RING, _p.set(x, y + 0.04, z), _v.set(0, 1, 0), radius, 0.35, L.life * 0.4, hue, 1, L.life);
  spawnGlow(_p.set(x, y + 0.4, z), L.glow * 0.5, L.glow, hue, 1, L.life, false, true);
  spawnGlow(_p.set(x, y + 1.6, z), 0.6, 1.2, WHITE, 0.8, L.life * 0.6, true, false);
  for (let k = 0; k < L.sparks; k++) {
    randomUnit(_v);
    _v.y = Math.abs(_v.y);
    _v.multiplyScalar(rand(L.sparkSpeed));
    spawnSpark(_p.set(x, y + 0.1, z), _v, hue, L.life * (0.8 + Math.random() * 0.6), 4);
  }
}

// A Bolt projectile or beam end: blue sparks and a small flash.
function zap(pos, hue) {
  _p.fromArray(pos);
  for (let k = 0; k < LOOK.bolt.sparks * 2; k++) {
    spawnSpark(_p, randomUnit(_v).multiplyScalar(rand([3, 7])), hue, 0.2 * (0.7 + Math.random() * 0.6), 3);
  }
  spawnGlow(_p, 0.3, 0.9, hue, 0.8, 0.12, false, false);
}

// A power-up killed before it went off (radius 0): a grey puff and a few voxels.
function fizzle(pos) {
  const L = LOOK.fizzle;
  const c = toColor(L.color);
  for (let k = 0; k < L.puffs; k++) {
    randomUnit(_v).multiplyScalar(0.8);
    spawnStreak(PUFF, _p.fromArray(pos).addScaledVector(_v, 0.15), _v, 0, L.size * 0.6, L.size, lit(c, _p), 0.7, L.life, Math.random() * TAU);
  }
  for (let k = 0; k < L.voxels; k++) {
    randomUnit(_v).multiplyScalar(2);
    _v.y += 1.5;
    spawnCube(_p.fromArray(pos), _v, _s.setScalar(L.voxelSize), c, L.life, 10, true);
  }
}

// A pickup at `pos` (the glyph): cubes in the item's colour and a ring.
export function pickupBurst(pos, color) {
  const L = LOOK.pickup;
  const c = toColor(color ?? WHITE);
  for (let k = 0; k < L.cubes; k++) {
    randomUnit(_v).multiplyScalar(L.speed);
    _v.y += 1;
    spawnCube(_p.fromArray(pos), _v, _s.setScalar(L.size), c, L.life * (0.8 + Math.random() * 0.4), 12, true, 0);
  }
  spawnStreak(RING, _p.fromArray(pos), _v.set(0, 1, 0), L.ring, L.band, L.life * 0.6, c, 1, L.life);
}

// Death: the body's boxes ({ min, max, color?, part? }, from the drawn rig or
// hitboxes()) break into about 120 voxels of ~0.1 m spread over every part,
// thrown out from the middle and along `dir` (any length; e.g. killer to
// victim). On a headshot the helmet part flies off whole and spinning.
// A player state ({ x, y, z, crouch }, the bible's call) breaks its hitboxes.
export function deathBurst(parts, color, dir, head = false) {
  if (!Array.isArray(parts)) parts = parts ? Object.values(hitboxes(parts)) : [];
  const L = LOOK.death;
  const base = toColor(color ?? L.color);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let shell = 0; // voxels on the surface of every part
  for (const { min, max } of parts) {
    cx += (min[0] + max[0]) / 2 / parts.length;
    cy += (min[1] + max[1]) / 2 / parts.length;
    cz += (min[2] + max[2]) / 2 / parts.length;
    const [n0, n1, n2] = voxelCounts(min, max);
    shell += n0 * n1 * n2 - Math.max(0, n0 - 2) * Math.max(0, n1 - 2) * Math.max(0, n2 - 2);
  }
  const dirLen = dir ? Math.hypot(dir[0], dir[1], dir[2]) : 0;
  const keep = Math.min(1, L.voxels / Math.max(1, shell));
  let owed = Math.random(); // an even share of the voxels from every part
  for (const part of parts) {
    const { min, max } = part;
    const c = part.color === undefined ? base : toColor(part.color);
    if (head && part.part === 'helmet') {
      _p.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      _v.set(0, 1, 0);
      if (dirLen > 0) _v.addScaledVector(_u.fromArray(dir), 0.6 / dirLen);
      _v.normalize().multiplyScalar(L.helmet);
      const i = spawnCube(_p, _v, _s.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]), c, rand(L.life), 0, false, 0);
      _u.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(L.helmetSpin);
      put(cube.spin, i * 3, _u);
      continue;
    }
    const [n0, n1, n2] = voxelCounts(min, max);
    const s0 = (max[0] - min[0]) / n0;
    const s1 = (max[1] - min[1]) / n1;
    const s2 = (max[2] - min[2]) / n2;
    for (let i = 0; i < n0; i++) {
      for (let j = 0; j < n1; j++) {
        for (let k = 0; k < n2; k++) {
          if (i > 0 && j > 0 && k > 0 && i < n0 - 1 && j < n1 - 1 && k < n2 - 1) continue; // hidden inside
          if ((owed += keep) < 1) continue;
          owed -= 1;
          _p.set(min[0] + (i + 0.5) * s0, min[1] + (j + 0.5) * s1, min[2] + (k + 0.5) * s2);
          _v.set(_p.x - cx, _p.y - cy, _p.z - cz);
          if (_v.lengthSq() < 1e-8) _v.set(0, 1, 0);
          _v.normalize().multiplyScalar(rand(L.speed));
          _v.y += L.up;
          if (dirLen > 0) _v.addScaledVector(_u.fromArray(dir), L.push / dirLen);
          spawnCube(_p, _v, _s.set(s0 * 0.9, s1 * 0.9, s2 * 0.9), c, rand(L.life), 8, false);
        }
      }
    }
  }
  if (!parts.length) return;
  for (let k = 0; k < L.puffs; k++) {
    randomUnit(_v).multiplyScalar(0.5);
    _p.set(cx + _v.x, cy + _v.y, cz + _v.z);
    spawnStreak(PUFF, _p, _v.multiplyScalar(2), 0, L.puffSize[0], L.puffSize[1], lit(toColor(L.puffColor), _p), L.puffAlpha, L.puffLife * (0.7 + Math.random() * 0.6), Math.random() * TAU);
  }
  spawnStreak(PUFF, _p.set(cx, cy, cz), _v.set(0, 0, 0), 0, L.flash * 0.8, L.flash, WHITE, 1, L.flashLife); // normal-blended: additive is for muzzles and blasts
}
const voxelCounts = (min, max) => [0, 1, 2].map((a) => Math.max(1, Math.round((max[a] - min[a]) / LOOK.death.voxel)));
// Kept for main.js: a death with no headshot.
export const shatter = (parts, color, push) => deathBurst(parts, color, push, false);

// Once per frame, before drawing, with the frame's timestamp in ms and the
// camera (for the casing range and the ?debug&fx loop).
let lastNow = null;
export function updateEffects(now, camera) {
  let dt = lastNow === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  if (camera) {
    cam.set = true;
    camera.getWorldPosition(cam.pos);
    camera.getWorldDirection(cam.fwd);
  }
  if (debug.scale) {
    dt *= debug.scale;
    debugLoop(dt);
  }
  clock.value += dt;
  updateCubes(dt);
  updatePoints(sparks, dt);
  updatePoints(dust, dt);
  updateStreaks(dt);
  updateGlows(dt);
  decals.visible = decals.count > 0;
}

// ---------------------------------------------------------------------------
// ?debug&fx[=timescale]: a scripted loop in front of the camera. Every 300 ms
// a shot at the nearest concrete, wood and steel box in turn (rifle, rifle,
// pistol, shotgun, Bolt), a power-up blast of each kind in turn every
// 800 ms, and a death burst every 4 s, a headshot every other time.
const debug = { scale: 0, t: 0, shots: 0, booms: 0, deaths: 0, targets: null, right: new THREE.Vector3(), focus: new THREE.Vector3() };
const DEBUG_WEAPONS = ['rifle', 'rifle', 'pistol', 'shotgun', 'bolt'];
const DEBUG_BOOMS = ['shunt', 'mine', 'barge', 'shock', 'fizzle'];
const SLOT_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#ff7eb6'];
// A stand-in rig, feet at the origin facing -z: [part, centre, size, colour (null: slot)].
const DEBUG_RIG = [
  ['boot', [-0.1, 0.06, 0], [0.16, 0.12, 0.26], '#1b1d22'], ['boot', [0.1, 0.06, 0], [0.16, 0.12, 0.26], '#1b1d22'],
  ['shin', [-0.1, 0.3, 0], [0.14, 0.36, 0.16], '#24272d'], ['shin', [0.1, 0.3, 0], [0.14, 0.36, 0.16], '#24272d'],
  ['thigh', [-0.1, 0.65, 0], [0.17, 0.42, 0.19], '#24272d'], ['thigh', [0.1, 0.65, 0], [0.17, 0.42, 0.19], '#24272d'],
  ['torso', [0, 1.1, 0], [0.4, 0.55, 0.26], null], ['pack', [0, 1.15, 0.2], [0.3, 0.4, 0.14], '#c7b48e'],
  ['upperArm', [-0.25, 1.18, 0], [0.1, 0.3, 0.11], '#24272d'], ['upperArm', [0.25, 1.18, 0], [0.1, 0.3, 0.11], '#24272d'],
  ['head', [0, 1.54, 0], [0.26, 0.24, 0.26], '#24272d'], ['helmet', [0, 1.735, 0], [0.3, 0.13, 0.3], null],
];

function debugLoop(dt) {
  if (!cam.set || !boxes.length) return;
  debug.t += dt;
  const right = debug.right.crossVectors(cam.fwd, _y.set(0, 1, 0)).normalize();
  const focus = debug.focus.copy(cam.pos).addScaledVector(cam.fwd, 8);
  if (!debug.targets) {
    debug.targets = {};
    for (const kind of ['concrete', 'wood', 'steel']) {
      let best = Infinity;
      boxes.forEach(({ min, max }, b) => {
        if (b === 0 || surfaces[b]?.kind !== kind) return;
        _p.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
        if (_u.copy(_p).sub(cam.pos).dot(cam.fwd) < 2) return; // behind us
        const d = _p.distanceTo(focus);
        if (d < best) { best = d; debug.targets[kind] = b; }
      });
    }
  }
  if (debug.t >= debug.shots * 0.3) {
    const n = debug.shots++;
    const from = _p.copy(cam.pos).addScaledVector(right, -2.5).addScaledVector(cam.fwd, 1.5).toArray();
    from[1] -= 0.3;
    if (n % 4 === 3) { // a miss into the sky, across the view
      _v.copy(cam.fwd).multiplyScalar(0.8).addScaledVector(right, 0.9).add(_u.set(0, 0.3, 0)).normalize();
      shot({ from, ends: [from.map((o, a) => o + _v.getComponent(a) * SHOT_RANGE)], weapon: 'rifle' });
    }
    const target = boxes[debug.targets[['concrete', 'wood', 'steel'][n % 4]]];
    const weapon = DEBUG_WEAPONS[n % DEBUG_WEAPONS.length];
    if (target) {
      const ends = [];
      for (let k = weapon === 'shotgun' ? 12 : 1; k > 0; k--) {
        const aim = [0, 1, 2].map((a) => target.min[a] + (target.max[a] - target.min[a]) * (0.5 + (Math.random() - 0.5) * (weapon === 'shotgun' ? 0.9 : 0.6)));
        const dir = _v.set(aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]).normalize().toArray();
        let t = SHOT_RANGE;
        for (const { min, max } of boxes) t = Math.min(t, rayBox(from, dir, min, max));
        ends.push(from.map((o, a) => o + dir[a] * t));
      }
      shot({ from, ends, weapon });
      muzzle(from);
      casing(from, right.toArray(), weapon === 'bolt' ? 'rifle' : weapon);
    }
  }
  if (debug.t >= 0.5 + debug.booms * 0.8) {
    const kind = DEBUG_BOOMS[debug.booms++ % DEBUG_BOOMS.length];
    const side = (debug.booms % 3) - 1;
    const at = _p.copy(focus).addScaledVector(right, side * 2.5).addScaledVector(cam.fwd, 2);
    const ground = floorBelow(at.x, at.y, at.z, 5) ?? 0;
    blast(kind === 'fizzle' ? 'shunt' : kind, [at.x, kind === 'fizzle' ? ground + 1.2 : ground + 0.3, at.z], kind === 'fizzle' ? 0 : undefined);
  }
  if (debug.t >= 0.2 + debug.deaths * 4) {
    const n = debug.deaths++;
    const at = _p.copy(focus).addScaledVector(right, 1.2);
    const ground = floorBelow(at.x, at.y, at.z, 5) ?? 0;
    const slot = SLOT_COLORS[n % SLOT_COLORS.length];
    const parts = DEBUG_RIG.map(([part, c, s, color]) => ({
      part,
      color: color ?? slot,
      min: [at.x + c[0] - s[0] / 2, ground + c[1] - s[1] / 2, at.z + c[2] - s[2] / 2],
      max: [at.x + c[0] + s[0] / 2, ground + c[1] + s[1] / 2, at.z + c[2] + s[2] / 2],
    }));
    deathBurst(parts, slot, cam.fwd.toArray(), n % 2 === 1);
  }
}
