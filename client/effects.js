// Short-lived visual effects, pooled so that a shot allocates nothing:
//   - debris cubes with CPU physics: wall chips, player hit cubes, shell
//     casings and the death shatter (one InstancedMesh);
//   - sparks and dust (one Points cloud each);
//   - bullet-hole decals on the hit face (a ring of slots);
//   - tracer streaks flying at bullet speed (camera-facing quads).
// At most five draw calls, all in one group the caller adds to the scene. A
// pool with nothing live is hidden, so an idle frame costs none.
import * as THREE from 'three';
import { MAP_COLORS, SHOT_RANGE } from '../shared/constants.js';
import { prepareMap } from '../shared/collision.js';
import { hitboxes } from '../shared/weapons.js';

// ---------------------------------------------------------------------------
// Look: neutral placeholders for the art pass. Metres, seconds and m/s;
// [min, max] pairs are ranges picked from at random.

// Debris cubes: the physics every kind shares.
const CUBES = {
  pool: 1024,
  gravity: 9.8,
  bounce: 0.35, // share of the speed into a face that comes back out
  minBounce: 0.5, // slower than this into a face: stop instead of bouncing
  slide: 0.6, // share of the speed along a face kept per bounce
  groundDrag: 6, // per second, sliding on a top face
  settle: 12, // per second, how fast a grounded cube rolls flat
  shrink: 0.35, // the last seconds of a life, shrinking to nothing
  shade: 0.12, // ± brightness per cube, so a pile is not one flat colour
};
// Wall impacts, per bullet; each shotgun pellet gets 1/sqrt(pellets) of the
// counts. SURFACES can override any field per surface.
const IMPACT = {
  chips: 4, chipSize: [0.018, 0.04], chipSpeed: [1.2, 3.2], chipPop: 1, chipLife: [0.8, 1.4], chipSpin: 14,
  chipColor: null, // null: the hit box's colour, lightened by chipLighten so chips show against it
  chipLighten: 0.3,
  sparks: 3, sparkSize: 0.025, sparkSpeed: [3, 7], sparkLife: [0.08, 0.22], sparkColor: '#ffd28a',
  flashSize: 0.16, flashLife: 0.05, // a glow on the spot for a frame or three, so a hit reads at range
  dust: 2, dustSize: [0.12, 0.5], dustSpeed: [0.3, 0.9], dustLife: [0.5, 1], dustAlpha: 0.5,
  dustColor: null, // null: the hit box's colour, lightened by dustLighten
  dustLighten: 0.45,
  decalSize: [0.07, 0.11], decalDarkness: 0.15, // the hole's core multiplies the wall by this
};
// Per surface, by the map box's `color` index, e.g. { 2: { sparks: 8, chips: 1 } }.
const SURFACES = {};
// Player hits: cubes in the victim's colour burst out, mostly along the shot.
const HITS = {
  cubes: 6, headCubes: 10, size: [0.03, 0.06], speed: 3, spray: 1.5, up: 1, life: [0.6, 1.1], spin: 12,
  puffs: 2, puffSize: [0.1, 0.35], puffLife: 0.3, puffAlpha: 0.6,
  color: '#9a9a9a', // when the victim is unknown
};
// Shell casings, thrown to the shooter's right.
const CASINGS = { size: [0.012, 0.012, 0.032], color: '#b5944f', speed: 2.2, up: 1.6, jitter: 0.4, spin: 22, life: 4 };
// Death shatter: each body box breaks into a hollow shell of voxels.
const SHATTER = { voxel: 0.15, gap: 0.9, max: 200, speed: 2.5, push: 3, up: 2, spin: 8, life: [2.2, 3.2], color: '#9a9a9a' };
// Points. Dust is normal-blended because additive dust glows against a bright
// sky; additive pools skip fog, which would add the fog colour.
const SPARKS = { pool: 512, gravity: 9.8, drag: 2, fade: 0.5, blending: THREE.AdditiveBlending };
const DUST = { pool: 256, gravity: -0.3, drag: 3.5, fade: 2, blending: THREE.NormalBlending };
const POINT_MIN_PIXELS = 1.5; // a smaller point is drawn this big, fainter
// Decals: core is the fully dark share of the radius, rim the darkness of the
// halo around it; near a face edge a hole shrinks to fit, down to minFit of
// its size, and is skipped below that.
const DECALS = { pool: 256, lift: 0.004, core: 0.32, rim: 0.5, minFit: 0.6 };
// Tracers: a streak `length` long flying at `speed`, fading in over nearFade
// metres from the camera; a far one is drawn minPixels wide, fainter.
const TRACERS = { pool: 128, speed: 400, length: 3, width: 0.025, alpha: 0.9, color: '#fff1c4', nearFade: [0.5, 3], minPixels: 1.25 };

// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const MAX_DT = 0.05; // a long frame, or a tab coming back, steps this much at most
const KILL_Y = -10; // a cube that falls off the world is freed
const WALL_EPS = 0.02; // m: shot ends are rounded to 1 mm on the wire
const PLAYER_MATCH = 0.5; // m: a remote hit can land this far from where we draw the victim

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
const WHITE = new THREE.Color(1, 1, 1);

const rand = (r) => r[0] + Math.random() * (r[1] - r[0]);
const count = (n) => Math.floor(n + Math.random()); // a fractional count, right on average
const put = (arr, i, v) => { arr[i] = v.x; arr[i + 1] = v.y; arr[i + 2] = v.z; };

function randomUnit(v) {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * TAU;
  const r = Math.sqrt(1 - z * z);
  return v.set(r * Math.cos(a), z, r * Math.sin(a));
}

// A Color passes through; anything else is parsed once and kept.
const colors = new Map();
function toColor(c) {
  if (c.isColor) return c;
  let color = colors.get(c);
  if (!color) colors.set(c, (color = new THREE.Color(c)));
  return color;
}

// The map: boxes for the physics and the hit classifier, and each box's look key.
let boxes = [];
let keys = [];
export function setMap(map) {
  boxes = prepareMap(map).boxes;
  keys = map.boxes.map((b) => b.color);
}

// Sizes in pixels need the drawing buffer's height, which follows render scale.
const halfHeight = { value: 540 };
function trackViewport(renderer) {
  halfHeight.value = renderer.getDrawingBufferSize(_size).y / 2;
}

// ---------------------------------------------------------------------------
// Debris cubes. Slots are reused round-robin, so when the pool is full the
// oldest cube goes; nothing is sorted and a dead slot is a zero matrix.
const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CUBES.pool);
cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage).array.fill(0);
cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CUBES.pool * 3), 3).setUsage(THREE.DynamicDrawUsage);
cubes.frustumCulled = false;
const cube = {
  pos: new Float32Array(CUBES.pool * 3),
  vel: new Float32Array(CUBES.pool * 3),
  rot: new Float32Array(CUBES.pool * 3), // Euler angles, YXZ: flat when x is a half turn and z a quarter
  spin: new Float32Array(CUBES.pool * 3),
  size: new Float32Array(CUBES.pool * 3),
  age: new Float32Array(CUBES.pool),
  life: new Float32Array(CUBES.pool), // 0: a free slot
  asleep: new Uint8Array(CUBES.pool),
  next: 0,
};

function spawnCube(p, v, s, color, life, spin, tumble) {
  // The next free slot a little ahead, sparing long-lived casings and
  // voxels under heavy fire; failing that, the oldest goes.
  let i = cube.next;
  for (let k = 0; k < 32 && cube.life[i] !== 0; k++) i = (i + 1) % CUBES.pool;
  if (cube.life[i] !== 0) i = cube.next;
  cube.next = (i + 1) % CUBES.pool;
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
  const k = 1 + (Math.random() * 2 - 1) * CUBES.shade;
  const col = cubes.instanceColor.array;
  col[i3] = color.r * k;
  col[i3 + 1] = color.g * k;
  col[i3 + 2] = color.b * k;
  cubes.instanceColor.needsUpdate = true;
}

// Push a cube out of any map box it has sunk into, through the nearest face,
// and bounce off that face. On a top face it slides to a stop, rolls flat and
// sleeps. f: its shrink factor.
function collide(i, dt, f) {
  const { pos, vel, rot, spin, size } = cube;
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
      vel[j] = vel[j] * out < -CUBES.minBounce ? -vel[j] * CUBES.bounce : 0;
      for (let a = 0; a < 3; a++) {
        if (a !== axis) vel[i3 + a] *= CUBES.slide;
        spin[i3 + a] *= CUBES.slide;
      }
    }
    if (axis === 1 && out === 1) grounded = true;
  }
  if (!grounded) return;
  const k = Math.exp(-CUBES.groundDrag * dt);
  vel[i3] *= k;
  vel[i3 + 2] *= k;
  for (let a = 0; a < 3; a++) spin[i3 + a] *= k;
  // Roll toward lying on a face. Half turns on x keep a long casing lying down.
  const s = Math.min(1, CUBES.settle * dt);
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
  let live = 0;
  let top = -1; // the highest live slot: no instance past it is drawn
  for (let i = 0; i < CUBES.pool; i++) {
    if (life[i] === 0) continue;
    const i3 = i * 3;
    age[i] += dt;
    if (age[i] >= life[i] || pos[i3 + 1] < KILL_Y) {
      life[i] = 0;
      mats.fill(0, i * 16, i * 16 + 16);
      continue;
    }
    live++;
    top = i;
    const f = Math.min(1, (life[i] - age[i]) / CUBES.shrink);
    if (!asleep[i]) {
      vel[i3 + 1] -= CUBES.gravity * dt;
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
  }
  cubes.visible = live > 0;
  cubes.count = top + 1;
  if (live) cubes.instanceMatrix.needsUpdate = true;
  else cube.next = 0; // all gone: start low again, so few instances are drawn
}

// ---------------------------------------------------------------------------
// Sparks and dust: round soft points, sized in metres.
const POINTS_VERTEX = /* glsl */ `
attribute float aSize; // metres across; 0 for a free slot
attribute vec4 aColor;
uniform float uHalfHeight;
uniform float uMinPixels;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float px = aSize * projectionMatrix[1][1] * uHalfHeight / max(-mvPosition.z, 0.01);
  vColor.a *= min(1.0, px * px / (uMinPixels * uMinPixels)); // a tiny point fades rather than shimmers
  gl_PointSize = aSize > 0.0 ? max(px, uMinPixels) : 0.0;
  #include <fog_vertex>
}`;
const POINTS_FRAGMENT = /* glsl */ `
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = vColor.a * max(0.0, 1.0 - dot(c, c));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makePoints(cfg, renderOrder) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['aColor', 4], ['aSize', 1]]) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(cfg.pool * size), size).setUsage(THREE.DynamicDrawUsage));
  }
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uHalfHeight: halfHeight, uMinPixels: { value: POINT_MIN_PIXELS } },
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    blending: cfg.blending,
    transparent: true,
    depthWrite: false,
    fog: cfg.blending !== THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  points.onBeforeRender = trackViewport;
  const { attributes } = geometry;
  return {
    cfg, points,
    pos: attributes.position.array, color: attributes.aColor.array, size: attributes.aSize.array,
    vel: new Float32Array(cfg.pool * 3),
    age: new Float32Array(cfg.pool),
    life: new Float32Array(cfg.pool), // 0: a free slot
    size0: new Float32Array(cfg.pool),
    size1: new Float32Array(cfg.pool),
    alpha: new Float32Array(cfg.pool),
    next: 0,
  };
}
const sparks = makePoints(SPARKS, 1);
const dust = makePoints(DUST, 0);

function spawnPoint(pool, p, v, color, alpha, size0, size1, life) {
  const i = pool.next;
  pool.next = (i + 1) % pool.cfg.pool;
  put(pool.pos, i * 3, p);
  put(pool.vel, i * 3, v);
  pool.color[i * 4] = color.r;
  pool.color[i * 4 + 1] = color.g;
  pool.color[i * 4 + 2] = color.b;
  pool.alpha[i] = alpha;
  pool.size0[i] = size0;
  pool.size1[i] = size1;
  pool.age[i] = -1; // not drawn yet
  pool.life[i] = life;
}

function updatePoints(pool, dt) {
  const { cfg, pos, vel, color, size, age, life, size0, size1, alpha } = pool;
  const drag = Math.exp(-cfg.drag * dt);
  let live = 0;
  for (let i = 0; i < cfg.pool; i++) {
    if (life[i] === 0) continue;
    age[i] = age[i] < 0 ? 0 : age[i] + dt; // a new point is drawn once, however slow the frame
    if (age[i] >= life[i]) {
      life[i] = 0;
      size[i] = 0;
      continue;
    }
    live++;
    const i3 = i * 3;
    const t = age[i] / life[i];
    vel[i3 + 1] -= cfg.gravity * dt;
    for (let a = 0; a < 3; a++) {
      vel[i3 + a] *= drag;
      pos[i3 + a] += vel[i3 + a] * dt;
    }
    size[i] = size0[i] + (size1[i] - size0[i]) * t;
    color[i * 4 + 3] = alpha[i] * (1 - t) ** cfg.fade;
  }
  pool.points.visible = live > 0;
  if (live) {
    const { attributes } = pool.points.geometry;
    attributes.position.needsUpdate = attributes.aColor.needsUpdate = attributes.aSize.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Bullet holes: quads on the hit face, multiplying the wall below them, so
// they darken it in any light and overlap in any order.
const DECAL_VERTEX = /* glsl */ `
attribute float aDark;
varying vec2 vUv;
varying float vDark;
#include <fog_pars_vertex>
void main() {
  vUv = uv * 2.0 - 1.0;
  vDark = aDark;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const DECAL_FRAGMENT = /* glsl */ `
uniform float uCore;
uniform float uRim;
varying vec2 vUv;
varying float vDark;
#include <fog_pars_fragment>
void main() {
  float angle = atan(vUv.y, vUv.x + 1e-6);
  float r = length(vUv) * (1.0 + 0.09 * sin(angle * 5.0) + 0.05 * sin(angle * 3.0 + 2.0)); // a ragged edge
  float cover = mix(uRim * (1.0 - smoothstep(uCore, 1.0, r)), 1.0, 1.0 - smoothstep(uCore * 0.7, uCore, r));
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      cover *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      cover *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  #endif
  gl_FragColor = vec4(vec3(vDark * cover), cover); // premultiplied: the wall × mix(1, dark, cover)
}`;

const decalGeometry = new THREE.PlaneGeometry(1, 1);
decalGeometry.setAttribute('aDark', new THREE.InstancedBufferAttribute(new Float32Array(DECALS.pool), 1));
const decals = new THREE.InstancedMesh(decalGeometry, new THREE.ShaderMaterial({
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uCore: { value: DECALS.core }, uRim: { value: DECALS.rim } },
  vertexShader: DECAL_VERTEX,
  fragmentShader: DECAL_FRAGMENT,
  blending: THREE.MultiplyBlending,
  premultipliedAlpha: true,
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  fog: true,
}), DECALS.pool);
decals.instanceMatrix.array.fill(0);
decals.frustumCulled = false;
decals.renderOrder = -1; // first of the blended pools, under dust, sparks and tracers
let decalNext = 0;
let decalCount = 0;

// A hole of `size` at `point` on the face with unit `normal`. Given the box,
// it shrinks to stay on the face near an edge, or is skipped right at one.
function spawnDecal(point, normal, size, darkness, box) {
  if (box) {
    const ax = Math.abs(normal[0]);
    const ay = Math.abs(normal[1]);
    const az = Math.abs(normal[2]);
    const axis = ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2);
    let room = Infinity;
    for (let a = 0; a < 3; a++) if (a !== axis) room = Math.min(room, point[a] - box.min[a], box.max[a] - point[a]);
    if (2 * room < size * DECALS.minFit) return;
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
  _m.setPosition(point[0] + _z.x * DECALS.lift, point[1] + _z.y * DECALS.lift, point[2] + _z.z * DECALS.lift);
  _m.toArray(decals.instanceMatrix.array, decalNext * 16);
  decalGeometry.attributes.aDark.array[decalNext] = darkness;
  decals.instanceMatrix.needsUpdate = decalGeometry.attributes.aDark.needsUpdate = true;
  decalNext = (decalNext + 1) % DECALS.pool;
  decalCount = Math.min(decalCount + 1, DECALS.pool);
}

// ---------------------------------------------------------------------------
// Tracers: one quad per streak, widened across the view in the vertex shader.
const TRACER_VERTEX = /* glsl */ `
attribute vec4 aTail; // xyz, width
attribute vec4 aHead; // xyz, alpha
uniform float uHalfHeight;
uniform float uMinPixels;
uniform vec2 uNearFade;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 p = mix(aTail.xyz, aHead.xyz, position.x);
  vec3 side = cross(aHead.xyz - aTail.xyz, p - cameraPosition);
  float len = length(side);
  side = len > 0.0 ? side / len : vec3(0.0);
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float depth = max(clip.w, 0.01);
  float width = max(aTail.w, uMinPixels * depth / (projectionMatrix[1][1] * uHalfHeight));
  vAlpha = aHead.w * aTail.w / width * smoothstep(uNearFade.x, uNearFade.y, depth); // widened: fainter
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * position.y * width * 0.5, 1.0);
}`;
const TRACER_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float across = 1.0 - abs(vUv.y);
  gl_FragColor = vec4(uColor, vAlpha * across * across * vUv.x); // bright head, fading tail
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const tracerGeometry = new THREE.InstancedBufferGeometry();
tracerGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
tracerGeometry.setIndex([0, 1, 2, 0, 2, 3]);
const tracerTail = new THREE.InstancedBufferAttribute(new Float32Array(TRACERS.pool * 4), 4).setUsage(THREE.DynamicDrawUsage);
const tracerHead = new THREE.InstancedBufferAttribute(new Float32Array(TRACERS.pool * 4), 4).setUsage(THREE.DynamicDrawUsage);
tracerGeometry.setAttribute('aTail', tracerTail);
tracerGeometry.setAttribute('aHead', tracerHead);
tracerGeometry.instanceCount = TRACERS.pool;
const tracers = new THREE.Mesh(tracerGeometry, new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(TRACERS.color) },
    uHalfHeight: halfHeight,
    uMinPixels: { value: TRACERS.minPixels },
    uNearFade: { value: new THREE.Vector2(...TRACERS.nearFade) },
  },
  vertexShader: TRACER_VERTEX,
  fragmentShader: TRACER_FRAGMENT,
  blending: THREE.AdditiveBlending,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
}));
tracers.frustumCulled = false;
tracers.renderOrder = 1;
tracers.onBeforeRender = trackViewport;
const tracer = {
  from: new Float32Array(TRACERS.pool * 3),
  dir: new Float32Array(TRACERS.pool * 3),
  dist: new Float32Array(TRACERS.pool),
  age: new Float32Array(TRACERS.pool),
  state: new Uint8Array(TRACERS.pool), // 0 free, 1 not drawn yet, 2 flying
  next: 0,
};

function updateTracers(dt) {
  const tail = tracerTail.array;
  const head = tracerHead.array;
  let live = 0;
  for (let i = 0; i < TRACERS.pool; i++) {
    if (tracer.state[i] === 0) continue;
    // A new streak is drawn once where it starts, however short the shot.
    if (tracer.state[i] === 1) tracer.state[i] = 2;
    else tracer.age[i] += dt;
    const back = tracer.age[i] * TRACERS.speed;
    const i3 = i * 3;
    const i4 = i * 4;
    if (back >= tracer.dist[i]) {
      tracer.state[i] = 0;
      tail.fill(0, i4, i4 + 4);
      head.fill(0, i4, i4 + 4);
      continue;
    }
    live++;
    const front = Math.min(back + TRACERS.length, tracer.dist[i]); // never past the impact
    for (let a = 0; a < 3; a++) {
      tail[i4 + a] = tracer.from[i3 + a] + tracer.dir[i3 + a] * back;
      head[i4 + a] = tracer.from[i3 + a] + tracer.dir[i3 + a] * front;
    }
    tail[i4 + 3] = TRACERS.width;
    head[i4 + 3] = TRACERS.alpha;
  }
  tracers.visible = live > 0;
  if (live) tracerTail.needsUpdate = tracerHead.needsUpdate = true;
}

effectsGroup.add(cubes, decals, dust.points, sparks.points, tracers);
// For tests and debugging.
export const pools = { cubes, decals, dust: dust.points, sparks: sparks.points, tracers };

// ---------------------------------------------------------------------------
// The API. Points and directions are [x, y, z] arrays; colours are Colors,
// numbers or CSS strings (a string is parsed once, then cached).

// What a shot that ran from `origin` to `end` hit, worked out from the map
// and the players ({ id, x, y, z, crouch }, as others() gives them):
//   kind 'wall': normal is the outward unit normal of the face it entered,
//     surface the map box's index (pass both to impact());
//   kind 'player': id and head from the nearest hitboxes(), id null if none
//     is near enough (the server hit them where the shooter saw them);
//   kind 'none': it flew out to SHOT_RANGE.
// dir is the shot's unit direction. The result is one shared object, valid
// until the next call.
const HIT = { kind: 'none', normal: [0, 0, 0], dir: [0, 0, 0], surface: -1, id: null, head: false };
export function classifyHit(origin, end, players) {
  const d = HIT.dir;
  const len = Math.hypot(end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]) || 1;
  for (let a = 0; a < 3; a++) d[a] = (end[a] - origin[a]) / len;
  HIT.kind = 'none';
  HIT.surface = -1;
  HIT.id = null;
  HIT.head = false;
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
    }
  }
  return HIT;
}

function boxDistance(p, { min, max }) {
  let sq = 0;
  for (let a = 0; a < 3; a++) sq += Math.max(min[a] - p[a], 0, p[a] - max[a]) ** 2;
  return Math.sqrt(sq);
}

// A bullet hitting the map at `point`, on the face with outward unit `normal`:
// chips of the surface fly off it, with sparks, dust and a hole. surface: the
// map box index classifyHit gives (it picks the look and fits the hole on the
// face). scale: the share of the counts, 1 per bullet.
export function impact(point, normal, surface, scale = 1) {
  const look = lookOf(keys[surface]);
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];
  for (let k = count(look.chips * scale); k > 0; k--) {
    const size = rand(look.chipSize);
    _p.set(point[0] + nx * size, point[1] + ny * size, point[2] + nz * size); // off the face, so the push-out can't sink it
    randomUnit(_v).multiplyScalar(look.chipSpeed[0] * 0.6).addScaledVector(_u.set(nx, ny, nz), rand(look.chipSpeed));
    _v.y += look.chipPop;
    spawnCube(_p, _v, _s.setScalar(size), look.chipColor, rand(look.chipLife), look.chipSpin, true);
  }
  _p.set(point[0] + nx * 0.02, point[1] + ny * 0.02, point[2] + nz * 0.02);
  spawnPoint(sparks, _p, _v.set(0, 0, 0), look.sparkColor, 1, look.flashSize, look.flashSize * 0.5, look.flashLife);
  for (let k = count(look.sparks * scale); k > 0; k--) {
    randomUnit(_v).multiplyScalar(0.8).add(_u.set(nx, ny, nz)).normalize().multiplyScalar(rand(look.sparkSpeed));
    spawnPoint(sparks, _p.fromArray(point), _v, look.sparkColor, 1, look.sparkSize, look.sparkSize * 0.5, rand(look.sparkLife));
  }
  for (let k = count(look.dust * scale); k > 0; k--) {
    _p.set(point[0] + nx * 0.05, point[1] + ny * 0.05, point[2] + nz * 0.05);
    randomUnit(_v).multiplyScalar(0.25).addScaledVector(_u.set(nx, ny, nz), rand(look.dustSpeed));
    spawnPoint(dust, _p, _v, look.dustColor, look.dustAlpha, look.dustSize[0], look.dustSize[1], rand(look.dustLife));
  }
  spawnDecal(point, normal, rand(look.decalSize) * (0.5 + 0.5 * scale), look.decalDarkness, boxes[surface]);
}

// The look of a surface, resolved once per key: IMPACT overridden by
// SURFACES, colours parsed.
const looks = new Map();
function lookOf(key) {
  let look = looks.get(key);
  if (!look) {
    look = { ...IMPACT, ...SURFACES[key] };
    const own = toColor(MAP_COLORS[key] ?? HITS.color);
    look.chipColor = look.chipColor ? toColor(look.chipColor) : own.clone().lerp(WHITE, look.chipLighten);
    look.dustColor = look.dustColor ? toColor(look.dustColor) : own.clone().lerp(WHITE, look.dustLighten);
    look.sparkColor = toColor(look.sparkColor);
    looks.set(key, look);
  }
  return look;
}

// A bullet hitting a player at `point`, flying along unit `dir`: cubes in
// their `color` burst out, mostly along the shot. head: more of them.
export function playerHit(point, dir, color, head, scale = 1) {
  const c = toColor(color ?? HITS.color);
  for (let k = count((head ? HITS.headCubes : HITS.cubes) * scale); k > 0; k--) {
    randomUnit(_v).multiplyScalar(HITS.spray).addScaledVector(_u.fromArray(dir), HITS.speed * (Math.random() * 1.3 - 0.3));
    _v.y += HITS.up;
    spawnCube(_p.fromArray(point), _v, _s.setScalar(rand(HITS.size)), c, rand(HITS.life), HITS.spin, true);
  }
  for (let k = count(HITS.puffs * scale); k > 0; k--) {
    spawnPoint(dust, _p.fromArray(point), randomUnit(_v).multiplyScalar(0.6), c, HITS.puffAlpha, HITS.puffSize[0], HITS.puffSize[1], HITS.puffLife);
  }
}

// Death: each box ({ min, max, color? }, as hitboxes() gives them) breaks into
// a hollow shell of voxels that burst out from the middle of them all,
// pushed along `push` (any length; e.g. killer → victim) when given.
export function shatter(parts, color, push) {
  const base = toColor(color ?? SHATTER.color);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const { min, max } of parts) {
    cx += (min[0] + max[0]) / 2 / parts.length;
    cy += (min[1] + max[1]) / 2 / parts.length;
    cz += (min[2] + max[2]) / 2 / parts.length;
  }
  const pushLen = push ? Math.hypot(push[0], push[1], push[2]) : 0;
  let left = SHATTER.max;
  for (const part of parts) {
    const { min, max } = part;
    const c = part.color === undefined ? base : toColor(part.color);
    const n0 = Math.max(1, Math.round((max[0] - min[0]) / SHATTER.voxel));
    const n1 = Math.max(1, Math.round((max[1] - min[1]) / SHATTER.voxel));
    const n2 = Math.max(1, Math.round((max[2] - min[2]) / SHATTER.voxel));
    const s0 = (max[0] - min[0]) / n0;
    const s1 = (max[1] - min[1]) / n1;
    const s2 = (max[2] - min[2]) / n2;
    for (let i = 0; i < n0; i++) {
      for (let j = 0; j < n1; j++) {
        for (let k = 0; k < n2; k++) {
          if (i > 0 && j > 0 && k > 0 && i < n0 - 1 && j < n1 - 1 && k < n2 - 1) continue; // hidden inside
          if (left-- <= 0) return;
          _p.set(min[0] + (i + 0.5) * s0, min[1] + (j + 0.5) * s1, min[2] + (k + 0.5) * s2);
          _v.set(_p.x - cx, _p.y - cy, _p.z - cz);
          if (_v.lengthSq() < 1e-8) _v.set(0, 1, 0);
          _v.normalize().multiplyScalar(SHATTER.speed * (0.5 + Math.random() * 0.5));
          _v.y += SHATTER.up;
          if (pushLen > 0) _v.addScaledVector(_u.fromArray(push), (SHATTER.push / pushLen) * (0.6 + Math.random() * 0.4));
          spawnCube(_p, _v, _s.set(s0 * SHATTER.gap, s1 * SHATTER.gap, s2 * SHATTER.gap), c, rand(SHATTER.life), SHATTER.spin, false);
        }
      }
    }
  }
}

// A spent case thrown from `pos` along unit `dir` (the shooter's right), plus
// `carry`, the shooter's velocity, when given. It bounces and lies where it
// lands for a few seconds.
export function casing(pos, dir, carry) {
  randomUnit(_v).multiplyScalar(CASINGS.jitter).addScaledVector(_u.fromArray(dir), CASINGS.speed);
  _v.y += CASINGS.up;
  if (carry) _v.add(_u.fromArray(carry));
  spawnCube(_p.fromArray(pos), _v, _s.fromArray(CASINGS.size), toColor(CASINGS.color), CASINGS.life, CASINGS.spin, true);
}

// A tracer streak from `from` (the muzzle) to `to` (where the shot ended).
export function addTracer(from, to) {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (dist < 0.01) return;
  const i = tracer.next;
  tracer.next = (i + 1) % TRACERS.pool;
  for (let a = 0; a < 3; a++) {
    tracer.from[i * 3 + a] = from[a];
    tracer.dir[i * 3 + a] = (to[a] - from[a]) / dist;
  }
  tracer.dist[i] = dist;
  tracer.age[i] = 0;
  tracer.state[i] = 1;
}

// Once per frame, before drawing, with the frame's timestamp in ms.
let lastNow = null;
export function updateEffects(now) {
  const dt = lastNow === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  updateCubes(dt);
  updatePoints(sparks, dt);
  updatePoints(dust, dt);
  updateTracers(dt);
  decals.visible = decalCount > 0;
  decals.count = decalCount; // the ring fills from slot 0
}
