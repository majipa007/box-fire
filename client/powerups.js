// Power-ups on the client (docs/bible.md §4.4, §4.7): the pads (plinth, pool,
// spinning voxel glyph, beam, countdown and the next item's hologram), the
// entities from the `pu` snapshot (Shunt rockets with ribbon trails, Mines
// with their trigger rings, Shock telegraphs), the own-use ghosts, and the
// glue that times pick, use and boom events and hands them to effects,
// audio, feel and the HUD. Six instanced draws, rewritten in place each
// frame: plinths, floor quads (pools and rings), cubes, cube hulls, beams
// and trails. The frame loop allocates nothing.
//   initPowerups({ quality, boxes }) once the map is loaded; onSnapshot(m)
//   and onEvent(m, myId) per message; cast(kind, input) when prediction
//   uses one; updatePowerups(now, renderTick, camera) per frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { POWER_COLORS, POWER_PADS, POWERS, POWER_CAPACITY, TICK_RATE, INPUT_BUFFER } from '../shared/constants.js';
import { createPowers } from '../shared/powerups.js';
import { POWER_IDS, ENT, PU_STATE } from '../shared/protocol.js';
import { eyeOf, aimDir, traceShot } from '../shared/weapons.js';
import { rayBox } from '../shared/collision.js';
import { self, serverTick, others } from './net.js';
import { look, bindings } from './input.js';
// Siblings are called through namespaces with ?.: a call into an API that
// another workstream has not landed yet is a no-op, or uses the fallback here.
import * as audio from './audio.js';
import * as ui from './ui.js';
import * as fx from './effects.js';
import * as vm from './viewmodel.js';
import * as feel from './feel.js';

// ---- Look: every colour, size and timing, for the art pass. ----
const LOOK = {
  plinth: { radius: 0.8, height: 0.03, rim: 0.08, color: '#45474c', rimColor: '#ad9862', segments: 20 },
  // alpha 0.85, held to half the radius, with a light core, not the bible's
  // 0.35: at 0.35 over the dark plinth a pool reads as a tinted hole, not a
  // glow (a deviation).
  pool: { radius: 0.7, alpha: 0.85, respawning: 0.4, lift: 0.005 },
  glyph: { voxel: 0.08, hover: 1.0, spin: Math.PI / 2, bob: 0.08, bobHz: 0.5, core: '#ffffff', hull: '#15171c', hullScale: 1.25 },
  // base: rises from just over the glyph. refilling: a dim beam with no
  // white line while a pad refills, so it stays a landmark (a deviation).
  beam: { width: 0.15, top: 6, base: 1.4, flickerHz: 6, flickerLast: 3, refilling: 0.55 },
  countdown: { cubes: 24, size: 0.06, radius: 0.7, lift: 0.05, empty: '#45474c' },
  hologram: { scale: 0.6, toward: '#d9d4ca', mix: 0.6, pulseHz: 1, low: 0.85 },
  shunt: { body: [0.25, 0.25, 0.6], nose: 0.12, trail: [0.3, 2.5] },
  mine: { puck: [0.5, 0.12], top: 0.4, inner: 0.28, led: 0.06, ledColor: '#ff2a1a', armedHz: 1, fusedHz: 8, ringRange: 12 },
  shock: { pulseFrom: 2, pulseTo: 8, marker: [0.05, 6] },
  ghost: { blendMs: 100, timeoutMs: 300, muzzle: [0.2, -0.15, 0.6] },
  // Fallbacks until effects.blast / pickupBurst land: a ring band and voxels.
  burst: { ringMs: 180, lifeMs: 300, voxels: 12, speed: [3, 8], size: [0.08, 0.16], fizzle: '#9a9fa8' },
};
const MAX_CUBES = 1024;
const MAX_HULLS = 768;
const MAX_FLAT = 64;
const MAX_BEAMS = 32;
const MAX_TRAILS = 16;
const MAX_BITS = 128; // fallback burst voxels
// Our own Shunts are drawn in the present, like the ghost that launched
// them: the newest snapshot carried on by the ticks since it plus the
// input's trip (the server's input buffer and a tick of waiting), at most
// AHEAD_MAX ticks if snapshots stall. Others' entities are interpolated.
const LEAD_TICKS = INPUT_BUFFER + 1;
const AHEAD_MAX = 6;

// 7 × 7 glyphs, top row first: # item hue, o white core (the Mine's LED red), . empty.
const GLYPHS = {
  shunt: ['...#...', '..#o#..', '..#o#..', '.#ooo#.', '.#ooo#.', '#oo#oo#', '##...##'],
  bolt: ['...###.', '..##o..', '.##o...', '#ooooo#', '...o##.', '..o##..', '.###...'],
  barge: ['..###..', '.#ooo#.', '#o...o#', '#o...o#', '#o...o#', '.#ooo#.', '..###..'],
  shock: ['..###..', '.#ooo#.', '#ooooo#', '#ooooo#', '#######', '.#.#.#.', '#.#.#.#'],
  mine: ['#..#..#', '.#####.', '.#ooo#.', '##ooo##', '.#ooo#.', '.#####.', '#..#..#'],
  nitro: ['...#...', '..#o#..', '.#o.o#.', '#o.#.o#', '..#o#..', '.#o.o#.', '#o...o#'],
  shield: ['...#...', '.##o##.', '#ooooo#', '#ooooo#', '#ooooo#', '.##o##.', '...#...'],
};

const TAU = Math.PI * 2;
const col = (hex) => new THREE.Color(hex);
const HUE = Object.fromEntries(POWER_IDS.map((k) => [k, col(POWER_COLORS[k])]));
const WHITE = col('#ffffff');
const LED = col(LOOK.mine.ledColor);
const DARK = col(LOOK.glyph.hull);
const PUCK = col('#45474c');
const EMPTY = col(LOOK.countdown.empty);
const FIZZLE = col(LOOK.burst.fizzle);
// The hologram's colours: 60% of the way to pale concrete.
const HOLO = Object.fromEntries(POWER_IDS.map((k) => [k, HUE[k].clone().lerp(col(LOOK.hologram.toward), LOOK.hologram.mix)]));
const HOLO_CORE = WHITE.clone().lerp(col(LOOK.hologram.toward), LOOK.hologram.mix);
// Each glyph as voxel offsets from its centre: [x, y, core].
const VOXELS = Object.fromEntries(Object.entries(GLYPHS).map(([k, rows]) => [k, rows.flatMap((row, r) => [...row].flatMap((c, i) => (c === '.' ? [] : [[(i - 3) * LOOK.glyph.voxel, (3 - r) * LOOK.glyph.voxel, c === 'o']])))]));

// ---- Shaders: normal blending, light core and dark fringe (daylight-proof). ----
const FLAT_VERTEX = /* glsl */ `
attribute vec4 aData;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vData;
void main() {
  vUv = uv * 2.0 - 1.0;
  vColor = instanceColor;
  vData = aData;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
// aData: alpha, mode, p1, p2. Modes: 0 pool (radial fade), 1 dashed ring
// (p1 band width, p2 dashes), 2 pulsing ring (p1 band, p2 pulse 0..1),
// 3 blast ring (p1 band).
const FLAT_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vData;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float alpha = vData.x;
  int mode = int(vData.y + 0.5);
  vec3 c = vColor;
  float a;
  if (mode == 0) {
    c = mix(c, vec3(1.0), 0.3 * (1.0 - smoothstep(0.0, 0.6, r))); // a light core glows without additive blending
    a = alpha * (1.0 - smoothstep(0.5, 1.0, r)); // a held centre, so the hue reads from afar
  } else {
    float band = vData.z;
    float inner = 1.0 - band;
    float fringe = 0.04;
    float inBand = step(inner, r) * step(r, 1.0 - fringe);
    float edge = step(1.0 - fringe, r) + step(inner - fringe, r) * step(r, inner);
    if (mode == 1) {
      float ang = atan(vUv.y, vUv.x) / 6.2831853 + 0.5;
      float dash = step(0.5, fract(ang * vData.w));
      inBand *= dash;
      edge *= dash;
    }
    float fill = mode == 2 ? 0.3 * vData.w * (1.0 - step(inner, r)) : 0.0;
    if (mode == 3) c = mix(c, vec3(1.0), smoothstep(inner + band * 0.4, 1.0, r));
    float pulse = mode == 2 ? 0.55 + 0.45 * vData.w : 1.0;
    a = alpha * max(max(inBand * pulse, edge * 0.6), fill);
    c = mix(vec3(0.0083, 0.0091, 0.0123), c, step(0.5, inBand + fill * 4.0));
  }
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;
const BEAM_VERTEX = /* glsl */ `
attribute vec4 aData;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vData;
void main() {
  vUv = uv;
  vColor = instanceColor;
  vData = aData;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
// Across the quad: a white centre line, the hue, a dark fringe at each edge.
// aData: alpha, centre share, fringe share, top fade power.
const BEAM_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vData;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float fade = pow(1.0 - vUv.y, vData.w);
  vec3 c = vColor;
  float a = 0.75;
  if (x < vData.y) { c = mix(vec3(1.0), vColor, 0.15); a = 0.8; }
  else if (x > 1.0 - vData.z) { c = vec3(0.0083, 0.0091, 0.0123); a = 0.35; }
  gl_FragColor = vec4(c, a * fade * vData.x);
  #include <colorspace_fragment>
}`;
// A ribbon from its tail (u 0) to the rocket (u 1): hue fading to nothing,
// with a dark fringe along both edges.
const TRAIL_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vData;
void main() {
  float y = abs(vUv.y - 0.5) * 2.0;
  float a = vData.x * vUv.x;
  vec3 c = y < 0.25 ? mix(vColor, vec3(1.0), 0.5) : vColor;
  if (y > 0.75) { c = vec3(0.0083, 0.0091, 0.0123); a *= 0.6; }
  a *= 1.0 - smoothstep(0.85, 1.0, y);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

// ---- Meshes ----
export const powerupsGroup = new THREE.Group();
let plinths = null;
let flats = null;
let cubes = null;
let hulls = null;
let beams = null;
let trails = null;
let boxes = [];
let nFlat = 0;
let nCubes = 0;
let nHulls = 0;
let nBeams = 0;
let nTrails = 0;

// A unit cube with its faces shaded by direction, so unlit voxels read as solid.
function shadedCube() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.normal;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) c.fill(n.getY(i) > 0.5 ? 1 : n.getY(i) < -0.5 ? 0.55 : n.getX(i) !== 0 ? 0.86 : 0.74, i * 3, i * 3 + 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function plinthGeometry() {
  const { radius, height, rim, color, rimColor, segments } = LOOK.plinth;
  const paint = (g, hex) => {
    const c = col(hex);
    const a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const disc = paint(new THREE.CylinderGeometry(radius, radius, height, segments).translate(0, height / 2, 0), rimColor);
  const top = paint(new THREE.CircleGeometry(radius - rim, segments).rotateX(-Math.PI / 2).translate(0, height + 0.002, 0), color);
  return mergeGeometries([disc.toNonIndexed(), top.toNonIndexed()]);
}

function instanced(geometry, material, count, data = false, colors = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
  if (data) geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage));
  mesh.frustumCulled = false; // instances span the arena
  mesh.castShadow = false;
  mesh.count = 0;
  return mesh;
}

const quadMaterial = (vertexShader, fragmentShader, extra = {}) => new THREE.ShaderMaterial({
  vertexShader, fragmentShader, transparent: true, depthWrite: false, fog: false, toneMapped: false, ...extra,
});

// ---- State ----
// Until the first snapshot (the lobby, a join mid-scoreboard), every pad is
// up at its pool's first item, as a fresh match starts on the server.
const pads = POWER_PADS.map(({ pos: [x, y, z], pool }, i) => ({ x, y, z, kind: pool[0], ready: 0, span: 0, phase: i * 1.7 }));
const padView = pads.map((p) => ({ pos: [p.x, p.y, p.z], kind: p.kind, up: true })); // padStates()
const snaps = []; // { tick, en } from the last few snapshots, oldest first
const shownDir = new Map(); // eid → [x, y, z] heading, kept when a Shunt stops moving between snapshots
const pending = []; // others' events, waiting for the render tick
let myId = null;
let camera = null;
const ghosts = []; // { kind, t0, x, y, z, dir, eid, blendT0 }
const bits = Array.from({ length: MAX_BITS }, () => ({ t0: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, color: WHITE }));
const rings = Array.from({ length: 16 }, () => ({ t0: 0, life: 0, x: 0, y: 0, z: 0, r: 0, color: WHITE }));
let nextBit = 0;
let nextRing = 0;
const threat = { shock: null, shunts: [] };
const threatPool = Array.from({ length: 8 }, () => [0, 0, 0]);

const m4 = new THREE.Matrix4();
const q4 = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const d3 = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const DOWN = [0, -1, 0];
const AHEAD = [0, 0, -1];
const tint = new THREE.Color();

export function initPowerups({ boxes: mapBoxes = [] } = {}) {
  if (plinths) return;
  boxes = mapBoxes; // quality: one look for both presets, 6 draws either way
  plinths = new THREE.InstancedMesh(plinthGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), pads.length);
  pads.forEach((p, i) => plinths.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  plinths.receiveShadow = true;
  plinths.castShadow = false;
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  flats = instanced(flat, quadMaterial(FLAT_VERTEX, FLAT_FRAGMENT, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), MAX_FLAT, true);
  flats.renderOrder = 2;
  const cube = shadedCube();
  cubes = instanced(cube, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }), MAX_CUBES);
  hulls = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: LOOK.glyph.hull, side: THREE.BackSide, fog: false, toneMapped: false }), MAX_HULLS, false, false);
  beams = instanced(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), quadMaterial(BEAM_VERTEX, BEAM_FRAGMENT, { side: THREE.DoubleSide }), MAX_BEAMS, true);
  beams.renderOrder = 3;
  trails = instanced(new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0), quadMaterial(BEAM_VERTEX, TRAIL_FRAGMENT, { side: THREE.DoubleSide }), MAX_TRAILS, true);
  trails.renderOrder = 3;
  powerupsGroup.add(plinths, flats, cubes, hulls, beams, trails);
  if (!ui.updatePowers) buildHud(); // fallback until hud's power slots land
}

// ---- Messages ----

export function onSnapshot(m) {
  if (!m.pu) return;
  m.pu.pd.forEach(([k, ready, span], i) => {
    const p = pads[i];
    if (!p) return;
    p.kind = POWER_IDS[k];
    p.ready = ready;
    p.span = span;
  });
  snaps.push({ tick: m.tick, en: m.pu.en });
  if (snaps.length > 10) snaps.shift();
}

// Every event, as it arrives. Others' pick, use and boom wait for the
// render tick, so a blast lines up with the rocket drawn behind the server.
export function onEvent(m, id) {
  myId = id;
  if (m.e === 'spawn' && m.id === id) self.pw = createPowers(); // a new life starts empty
  if (m.e !== 'pick' && m.e !== 'use' && m.e !== 'boom') return;
  const own = m.id === id;
  if (m.e === 'use' && own) return; // played at prediction time
  if (m.e === 'boom' && own && m.k === 'barge') return; // drawn locally on use
  // Ours play on arrival: our pickups, and booms of our own Shunts (drawn
  // in the present) and Mines. The newest snapshot still holds them, unless
  // a Shunt burst on its launch tick: only its owner is credited for that.
  const ours = m.e === 'boom' && (ownerOf(m.eid) === id || (m.k === 'shunt' && m.r > 0 && own));
  if (ours && m.k === 'shunt') endGhost(m.eid);
  if ((own && m.e === 'pick') || ours) play(m);
  else pending.push(m);
}

// Our Shunt burst: its ghost goes now, even if its entity never showed.
function endGhost(eid) {
  for (const g of ghosts) {
    if (g.kind !== 'shunt' || (g.eid ? g.eid !== eid : g.known.has(eid))) continue;
    g.eid = eid;
    g.blendT0 = -Infinity; // spent: dropped on the next frame, drawn by nothing
    return;
  }
}

function ownerOf(eid) {
  const en = snaps.at(-1)?.en ?? [];
  for (let i = 0; i < en.length; i++) if (en[i][0] === eid) return en[i][2];
  return null;
}

function play(m) {
  if (m.e === 'pick') {
    const p = pads[m.pad];
    if (!p) return;
    const at = [p.x, p.y + LOOK.glyph.hover, p.z];
    if (fx.pickupBurst) fx.pickupBurst(at, POWER_COLORS[m.k]);
    else burst(at, HUE[m.k], 1, 10, 2);
    sound(m.k, 'pick', p.x, p.z);
    if (m.id === myId) ui.powerToast?.(m.k);
  } else if (m.e === 'use') {
    sound(m.k, 'use', m.x, m.z);
  } else {
    const at = [m.x, m.y, m.z];
    if (fx.blast) fx.blast(m.k, at, m.r);
    else if (m.r) burst(at, HUE[m.k], m.r, 24, 8);
    else burst(at, FIZZLE, 0.3, 6, 3);
    sound(m.k, m.r ? 'boom' : 'fizzle', m.x, m.z);
    const d = distanceTo(m.x, m.z);
    if (m.r && d < 8) feel.addTrauma?.((1 - d / 8) * 0.8);
  }
}

// Our own use, the step prediction made it: ghosts, the local Barge ring,
// our own Bolt beam, the sound and the viewmodel's cast.
export function cast(kind, input) {
  const me = self.mover;
  if (!me) return;
  const eye = eyeOf(me);
  const dir = aimDir(input.yaw, input.pitch);
  if (kind === 'bolt') {
    const targets = others(performance.now()).filter((o) => o.alive && o.id !== myId);
    const { t } = traceShot(eye, dir, boxes, targets);
    const end = eye.map((o, i) => o + dir[i] * t);
    const from = muzzle(eye, dir, input.yaw);
    if (fx.shot) fx.shot({ from, ends: [end], weapon: 'bolt', targets, own: true });
    else fx.addTracer?.(from, end); // fallback until effects draws Bolt beams
    if (audio.power) audio.gunshot('bolt');
    else audio.use?.('bolt');
    return;
  }
  if (kind === 'shunt' || kind === 'mine') ghost(kind, eye, dir);
  if (kind === 'barge') {
    const at = [me.x, me.y + (me.crouch ? 0.7 : 1), me.z];
    if (fx.blast) fx.blast('barge', at, POWERS.barge.radius);
    else burst(at, HUE.barge, POWERS.barge.radius, 0, 0);
  }
  sound(kind, 'use', me.x, me.z);
  vm.powerCast?.(kind);
}

// A stand-in for our own Shunt or Mine until the server's appears.
export function ghost(kind, eye, dir) {
  const g = { kind, t0: performance.now(), dir: [...dir], eid: 0, blendT0: 0, x: 0, y: 0, z: 0, from: null };
  if (kind === 'shunt') [g.x, g.y, g.z] = muzzle(eye, dir, Math.atan2(-dir[0], -dir[2]));
  else [g.x, g.y, g.z] = [self.mover.x, self.mover.y, self.mover.z];
  // Entities already ours are not this ghost's.
  g.known = new Set((snaps.at(-1)?.en ?? []).filter((e) => e[2] === myId).map((e) => e[0]));
  ghosts.push(g);
}

// Shock aimed at us (seconds to its first strike) and Shunts locked on us.
export function threats(id = myId) {
  threat.shock = null;
  threat.shunts.length = 0;
  const s = snaps.at(-1);
  if (!s) return threat;
  const now = serverTick(performance.now());
  for (const e of s.en) {
    if (e[1] === ENT.DOME && e[7] === id) {
      const t = (e[6] - now) / TICK_RATE;
      if (t > 0 && (threat.shock === null || t < threat.shock)) threat.shock = t;
    } else if (e[1] === ENT.SHUNT && e[6] === id && threat.shunts.length < threatPool.length) {
      const p = threatPool[threat.shunts.length];
      p[0] = e[3];
      p[1] = e[4];
      p[2] = e[5];
      threat.shunts.push(p);
    }
  }
  return threat;
}

export function padStates() {
  for (let i = 0; i < pads.length; i++) {
    padView[i].kind = pads[i].kind;
    padView[i].up = !pads[i].ready;
  }
  return padView;
}

// ---- Frame ----

export function updatePowerups(now, renderTick, cam) {
  if (!plinths) return;
  camera = cam;
  if (DEMO) demo(now, renderTick);
  nFlat = nCubes = nHulls = nBeams = nTrails = 0;
  while (pending.length && renderTick >= pending[0].tick) play(pending.shift());
  if (pending.length > 64) pending.splice(0, pending.length - 64); // a stalled clock: drop, don't flood
  const s = now / 1000;
  const tick = serverTick(now);
  drawPads(s, tick);
  flyGhosts(now);
  drawEntities(s, renderTick, tick);
  drawGhosts(now);
  drawBursts(now);
  upload(flats, nFlat);
  upload(cubes, nCubes);
  upload(hulls, nHulls);
  upload(beams, nBeams);
  upload(trails, nTrails);
  hud();
}

// Draw the first n instances, uploading only those.
function upload(mesh, n) {
  mesh.count = n;
  mesh.visible = n > 0;
  if (!n) return;
  flush(mesh.instanceMatrix, n, 16);
  if (mesh.instanceColor) flush(mesh.instanceColor, n, 3);
  if (mesh.geometry.attributes.aData) flush(mesh.geometry.attributes.aData, n, 4);
}

function flush(attr, n, size) {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * size);
  attr.needsUpdate = true;
}

function drawPads(s, tick) {
  const G = LOOK.glyph;
  for (const p of pads) {
    const hue = HUE[p.kind];
    const left = p.ready ? Math.max(0, (p.ready - tick) / TICK_RATE) : 0;
    const up = left <= 0;
    flat(p.x, p.y + LOOK.plinth.height + LOOK.pool.lift, p.z, LOOK.pool.radius, hue, LOOK.pool.alpha * (up ? 1 : LOOK.pool.respawning), 0, 0, 0);
    const yaw = G.spin * s + p.phase;
    const y = p.y + G.hover + Math.sin(TAU * G.bobHz * s + p.phase) * G.bob;
    if (up) {
      glyph(p.kind, p.x, y, p.z, yaw, 1, hue, WHITE, true);
      beam(p.x, p.y, p.z, hue, 1, true);
      continue;
    }
    // Refilling: the next item as a pulsing hologram, a ring of countdown
    // cubes, and a dim beam that flickers to full over the last few seconds.
    const pulse = LOOK.hologram.low + (1 - LOOK.hologram.low) * (0.5 + 0.5 * Math.sin(TAU * LOOK.hologram.pulseHz * s));
    // No hull: with the 24 countdown cubes, 9 hulled holograms pass the 9k triangles.
    glyph(p.kind, p.x, y, p.z, yaw, LOOK.hologram.scale, tint.copy(HOLO[p.kind]).multiplyScalar(pulse), HOLO_CORE, false);
    const C = LOOK.countdown;
    const filled = Math.floor(C.cubes * Math.min(1, 1 - (left * TICK_RATE) / (p.span || 1)));
    for (let i = 0; i < C.cubes; i++) {
      const a = (i / C.cubes) * TAU;
      cube(p.x + Math.sin(a) * C.radius, p.y + LOOK.plinth.height + C.lift, p.z - Math.cos(a) * C.radius, C.size, C.size, C.size, -a, i < filled ? hue : EMPTY, false);
    }
    const full = left < LOOK.beam.flickerLast && Math.sin(TAU * LOOK.beam.flickerHz * s) > 0;
    beam(p.x, p.y, p.z, hue, full ? 1 : LOOK.beam.refilling, full);
  }
}

// One glyph: voxels in the hue around a white core, with a dark hull.
function glyph(kind, x, y, z, yaw, scale, hue, core, hull) {
  const v = LOOK.glyph.voxel * scale;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const coreColor = kind === 'mine' && core === WHITE ? LED : core;
  const voxels = VOXELS[kind];
  for (let i = 0; i < voxels.length; i++) {
    const vx = voxels[i];
    const px = vx[0] * scale;
    cube(x + c * px, y + vx[1] * scale, z - sn * px, v, v, v, yaw, vx[2] ? coreColor : hue, hull);
  }
}

function drawEntities(s, rt, now) {
  if (!snaps.length) return;
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].tick > rt) i--;
  const b = snaps[i];
  const a = i > 0 && snaps[i - 1].tick <= rt ? snaps[i - 1] : b;
  const t = a === b ? 0 : Math.min(1, (rt - a.tick) / (b.tick - a.tick));
  const me = self.mover;
  for (let j = 0; j < b.en.length; j++) {
    const e = b.en[j];
    const eid = e[0];
    const type = e[1];
    const x1 = e[3];
    const y1 = e[4];
    const z1 = e[5];
    const sa = e[6];
    if (type === ENT.SHUNT && e[2] === myId) continue; // drawn below, in the present
    let from = e;
    for (let k = 0; k < a.en.length; k++) if (a.en[k][0] === eid) from = a.en[k];
    const x = from[3] + (x1 - from[3]) * t;
    const y = from[4] + (y1 - from[4]) * t;
    const z = from[5] + (z1 - from[5]) * t;
    const ghosted = ghostFor(e, x, y, z);
    if (ghosted) continue;
    if (type === ENT.SHUNT) {
      rocket(x, y, z, heading(eid, x1 - from[3], y1 - from[4], z1 - from[5]), 1);
    } else if (type === ENT.MINE) {
      const near = !me || Math.hypot(me.x - x, me.z - z) < LOOK.mine.ringRange;
      mine(x, y, z, sa, s, near);
    } else if (type === ENT.DOME) {
      telegraph(x, groundUnder(eid, x, y, z), z, (sa - rt) / TICK_RATE);
    }
  }
  // Our own Shunts: the newest snapshot, carried on along its last step.
  const nb = snaps[snaps.length - 1];
  const na = snaps[snaps.length - 2] ?? nb;
  const ahead = Math.max(0, Math.min(AHEAD_MAX, now - nb.tick + LEAD_TICKS)) / Math.max(1, nb.tick - na.tick);
  for (let j = 0; j < nb.en.length; j++) {
    const e = nb.en[j];
    if (e[1] !== ENT.SHUNT || e[2] !== myId) continue;
    let from = e;
    for (let k = 0; k < na.en.length; k++) if (na.en[k][0] === e[0]) from = na.en[k];
    if (from === e) continue; // just launched: its ghost flies on until it has a heading
    const dx = e[3] - from[3];
    const dy = e[4] - from[4];
    const dz = e[5] - from[5];
    const x = e[3] + dx * ahead;
    const y = e[4] + dy * ahead;
    const z = e[5] + dz * ahead;
    if (!ghostFor(e, x, y, z)) rocket(x, y, z, heading(e[0], dx, dy, dz), 1);
  }
  if (shownDir.size > 32) shownDir.clear();
}

// A Shunt's heading from its last step, kept while it stands still.
function heading(eid, dx, dy, dz) {
  let dir = shownDir.get(eid);
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-4) {
    if (!dir) shownDir.set(eid, (dir = [0, 0, 0]));
    dir[0] = dx / len;
    dir[1] = dy / len;
    dir[2] = dz / len;
  }
  return dir ?? AHEAD;
}

function rocket(x, y, z, dir, fade) {
  const S = LOOK.shunt;
  q4.setFromUnitVectors(Z, d3.set(dir[0], dir[1], dir[2]));
  cubeQ(x, y, z, S.body[0] * fade, S.body[1] * fade, S.body[2] * fade, HUE.shunt);
  const n = S.body[2] / 2;
  cubeQ(x + dir[0] * n, y + dir[1] * n, z + dir[2] * n, S.nose * fade, S.nose * fade, S.nose * fade, WHITE);
  // The ribbon: from the tail back along the flight, facing the camera.
  const [w, len] = S.trail;
  const tx = x - dir[0] * n;
  const ty = y - dir[1] * n;
  const tz = z - dir[2] * n;
  trail(tx - dir[0] * len, ty - dir[1] * len, tz - dir[2] * len, dir, len, w * fade, HUE.shunt, 0.6 * fade);
}

function mine(x, y, z, state, s, near) {
  const M = LOOK.mine;
  const [w, h] = M.puck;
  cube(x, y + h / 2, z, w, h, w, 0, PUCK, true);
  cube(x, y + h + 0.005, z, M.top, 0.01, M.top, 0, WHITE, false);
  cube(x, y + h + 0.008, z, M.inner, 0.012, M.inner, 0, PUCK, false);
  const hz = state === PU_STATE.FUSED ? M.fusedHz : M.armedHz;
  const lit = state !== PU_STATE.ARMING && Math.sin(TAU * hz * s) > 0;
  cube(x, y + h + M.led / 2, z, M.led, M.led, M.led, 0, lit ? LED : tint.copy(LED).multiplyScalar(0.25), false);
  if (near) flat(x, y + 0.01, z, POWERS.mine.trigger, WHITE, 0.5, 1, 0.06, 24);
}

function telegraph(x, y, z, left) {
  const { radius } = POWERS.shock;
  const { lead } = POWERS.shock;
  const k = Math.min(1, Math.max(0, 1 - left / lead));
  const hz = LOOK.shock.pulseFrom + (LOOK.shock.pulseTo - LOOK.shock.pulseFrom) * k;
  const pulse = 0.5 + 0.5 * Math.sin(TAU * hz * Math.max(0, lead - left));
  flat(x, y + 0.01, z, radius, HUE.shock, 0.6, 2, 0.08, pulse);
  const [mw, mh] = LOOK.shock.marker;
  for (let i = 0; i < 2; i++) beamQuad(x, y, z, i * (Math.PI / 2), mw, mh, HUE.shock, 0.8, 0.3, 0.3, 1.5);
}

// The surface under a Shock dome. The server places domes at the target's
// height, which is in the air when it was jumping, so the ring drops to the
// floor. Cached per dome; eids restart each match, so the spot is checked too.
const grounds = new Map(); // eid → { x, z, y }
function groundUnder(eid, x, y, z) {
  let g = grounds.get(eid);
  if (g && g.x === x && g.z === z) return g.y;
  if (!g) {
    if (grounds.size > 32) grounds.clear();
    grounds.set(eid, (g = { x, z, y }));
  }
  g.x = x;
  g.z = z;
  g.y = dropTo(x, y, z);
  return g.y;
}

// The top of whatever is under (x, y, z), or y over nothing.
const rayFrom = [0, 0, 0];
function dropTo(x, y, z) {
  rayFrom[0] = x;
  rayFrom[1] = y + 0.05;
  rayFrom[2] = z;
  let t = Infinity;
  for (const b of boxes) t = Math.min(t, rayBox(rayFrom, DOWN, b.min, b.max));
  return Number.isFinite(t) ? rayFrom[1] - t : y;
}

// Ghosts fly or sit until the server's entity shows, then hand over.
function ghostFor(e, x, y, z) {
  for (const g of ghosts) {
    if (g.eid === e[0]) {
      const k = Math.min(1, (performance.now() - g.blendT0) / LOOK.ghost.blendMs);
      if (k >= 1) return false;
      draw(g, g.x + (x - g.x) * k, g.y + (y - g.y) * k, g.z + (z - g.z) * k, 1);
      return true;
    }
    if (!g.eid && e[2] === myId && !g.known.has(e[0]) && e[1] === (g.kind === 'shunt' ? ENT.SHUNT : ENT.MINE)) {
      g.eid = e[0];
      g.blendT0 = performance.now();
      return ghostFor(e, x, y, z);
    }
  }
  return false;
}

// Before the entities: drop spent ghosts and fly the rest on, through
// their blend too, so a handover never stalls.
function flyGhosts(now) {
  const G = LOOK.ghost;
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const g = ghosts[i];
    if ((g.eid && now - g.blendT0 > G.blendMs) || (!g.eid && now - g.t0 > G.timeoutMs * 2)) {
      ghosts.splice(i, 1);
      continue;
    }
    if (g.kind !== 'shunt') continue;
    const d = (POWERS.shunt.speed * (now - (g.last ?? g.t0))) / 1000;
    g.last = now;
    g.x += g.dir[0] * d;
    g.y += g.dir[1] * d;
    g.z += g.dir[2] * d;
  }
}

// After them: the ghosts no entity has claimed, fading after the timeout.
function drawGhosts(now) {
  const G = LOOK.ghost;
  for (const g of ghosts) {
    const age = now - g.t0;
    if (!g.eid) draw(g, g.x, g.y, g.z, age < G.timeoutMs ? 1 : 1 - (age - G.timeoutMs) / G.timeoutMs);
  }
}

function draw(g, x, y, z, fade) {
  if (g.kind === 'shunt') rocket(x, y, z, g.dir, fade);
  else if (fade > 0.5) mine(x, y, z, PU_STATE.ARMING, 0, true);
}

// ---- ?debug&pu=demo: every look at once around the centre pad, for review
// shots from ?debug&cam=-4,2.4,-4,-2.6,-0.2 ----
const DEMO = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search) && /[?&]pu=demo\b/.test(location.search);
let demoBoom = 0;
function demo(now, rt) {
  const tick = serverTick(now);
  const left = (secs) => tick + secs * TICK_RATE;
  pads[3].ready = left(8 + 4 * Math.sin(now / 4000)); // refilling, the hologram up
  pads[3].span = 20 * TICK_RATE;
  pads[4].ready = left(2.5 - ((now / 1000) % 2.5)); // the last seconds: the beam flickers
  pads[4].span = 20 * TICK_RATE;
  const a = now / 600;
  const strike = 72 - Math.floor((now / 1000) * TICK_RATE) % 72;
  snaps.length = 0;
  snaps.push({ tick: rt, en: [
    [901, ENT.SHUNT, 0, Math.sin(a) * 2.5, 1.4, 3 + Math.cos(a) * 2.5, 0, 0],
    [902, ENT.MINE, 0, -2.5, 0, 1.5, PU_STATE.ARMED, 0],
    [903, ENT.MINE, 0, 2.5, 0, 1.5, PU_STATE.FUSED, 0],
    [904, ENT.DOME, 0, 0, 1, 6.5, rt + strike, 0], // cast at a jumping target: the ring still lies on the floor
  ] });
  snaps.unshift({ tick: rt - 1, en: [[901, ENT.SHUNT, 0, Math.sin(a - 0.03) * 2.5, 1.4, 3 + Math.cos(a - 0.03) * 2.5, 0, 0]] });
  if (now - demoBoom > 2000) {
    demoBoom = now;
    play({ e: 'boom', k: 'shunt', x: 3, y: 1, z: 7, r: POWERS.shunt.splash });
  }
}

// ---- Fallback blasts and pickup bursts (until effects.blast lands) ----

function burst(at, color, r, count, speed) {
  const ring = rings[nextRing];
  nextRing = (nextRing + 1) % rings.length;
  // The ring lies on whatever is under the blast.
  Object.assign(ring, { t0: performance.now(), life: LOOK.burst.lifeMs, x: at[0], y: dropTo(at[0], at[1], at[2]), z: at[2], r, color });
  for (let i = 0; i < count; i++) {
    const b = bits[nextBit];
    nextBit = (nextBit + 1) % MAX_BITS;
    const a = Math.random() * TAU;
    const up = Math.random();
    const v = speed * (0.4 + 0.6 * Math.random());
    const [s0, s1] = LOOK.burst.size;
    Object.assign(b, {
      t0: performance.now(), life: 600 + Math.random() * 600, x: at[0], y: at[1], z: at[2],
      vx: Math.cos(a) * v * (1 - up * 0.5), vy: up * v + 2, vz: Math.sin(a) * v * (1 - up * 0.5), size: (s0 + Math.random() * (s1 - s0)) * (r ? 1 : 0.6), color: i % 4 ? color : WHITE,
    });
  }
}

function drawBursts(now) {
  for (const ring of rings) {
    const age = now - ring.t0;
    if (age >= ring.life || !ring.r) continue;
    const grow = Math.min(1, age / LOOK.burst.ringMs);
    const r = ring.r * (1 - (1 - grow) ** 3);
    flat(ring.x, ring.y + 0.02, ring.z, Math.max(0.05, r), ring.color, 1 - age / ring.life, 3, Math.min(1, 0.3 / Math.max(r, 0.3)), 0);
  }
  for (const b of bits) {
    const t = (now - b.t0) / 1000;
    if (t * 1000 >= b.life) continue;
    const y = b.y + b.vy * t - 10 * t * t;
    if (y < -0.5) continue;
    const k = 1 - (t * 1000) / b.life;
    cube(b.x + b.vx * t, Math.max(0.05, y), b.z + b.vz * t, b.size * k, b.size * k, b.size * k, t * 6, b.color, false);
  }
}

// ---- Instance writers ----

// A cube turned `yaw` about the vertical.
function cube(x, y, z, sx, sy, sz, yaw, color, hull) {
  if (nCubes >= MAX_CUBES) return;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  writeYaw(cubes.instanceMatrix.array, nCubes * 16, x, y, z, sx, sy, sz, c, s);
  color.toArray(cubes.instanceColor.array, nCubes * 3);
  nCubes++;
  if (!hull || nHulls >= MAX_HULLS) return;
  const h = LOOK.glyph.hullScale;
  writeYaw(hulls.instanceMatrix.array, nHulls * 16, x, y, z, sx * h, sy * h, sz * h, c, s);
  nHulls++;
}

// A cube turned by q4, always with a hull.
function cubeQ(x, y, z, sx, sy, sz, color) {
  if (nCubes >= MAX_CUBES || nHulls >= MAX_HULLS) return;
  m4.compose(v3.set(x, y, z), q4, s3.set(sx, sy, sz)).toArray(cubes.instanceMatrix.array, nCubes * 16);
  color.toArray(cubes.instanceColor.array, nCubes * 3);
  nCubes++;
  const h = LOOK.glyph.hullScale;
  m4.compose(v3, q4, s3.multiplyScalar(h)).toArray(hulls.instanceMatrix.array, nHulls * 16);
  nHulls++;
}

function writeYaw(a, o, x, y, z, sx, sy, sz, c, s) {
  a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

// A floor quad of radius r: see FLAT_FRAGMENT for the modes.
function flat(x, y, z, r, color, alpha, mode, p1, p2) {
  if (nFlat >= MAX_FLAT) return;
  writeYaw(flats.instanceMatrix.array, nFlat * 16, x, y, z, 2 * r, 1, 2 * r, 1, 0);
  color.toArray(flats.instanceColor.array, nFlat * 3);
  const d = flats.geometry.attributes.aData.array;
  d[nFlat * 4] = alpha;
  d[nFlat * 4 + 1] = mode;
  d[nFlat * 4 + 2] = p1;
  d[nFlat * 4 + 3] = p2;
  nFlat++;
}

// A pad's beam: two crossed quads, with the white centre line when `lit`.
function beam(x, y, z, color, alpha, lit) {
  const B = LOOK.beam;
  for (let i = 0; i < 2; i++) beamQuad(x, y + B.base, z, Math.PI / 4 + i * (Math.PI / 2), B.width, B.top - B.base, color, alpha, lit ? 0.04 / B.width : 0, 0.04 / B.width, 0.6);
}

function beamQuad(x, y, z, yaw, w, h, color, alpha, centre, fringe, power) {
  if (nBeams >= MAX_BEAMS) return;
  writeYaw(beams.instanceMatrix.array, nBeams * 16, x, y, z, w, h, 1, Math.cos(yaw), Math.sin(yaw));
  color.toArray(beams.instanceColor.array, nBeams * 3);
  const d = beams.geometry.attributes.aData.array;
  d[nBeams * 4] = alpha;
  d[nBeams * 4 + 1] = centre;
  d[nBeams * 4 + 2] = fringe;
  d[nBeams * 4 + 3] = power;
  nBeams++;
}

// A ribbon from (x, y, z) along dir for len metres, turned to face the camera.
function trail(x, y, z, dir, len, w, color, alpha) {
  if (nTrails >= MAX_TRAILS || !camera) return;
  const p = camera.position;
  const mx = x + dir[0] * len * 0.5;
  const my = y + dir[1] * len * 0.5;
  const mz = z + dir[2] * len * 0.5;
  // width axis: dir × (camera - mid)
  let wx = dir[1] * (p.z - mz) - dir[2] * (p.y - my);
  let wy = dir[2] * (p.x - mx) - dir[0] * (p.z - mz);
  let wz = dir[0] * (p.y - my) - dir[1] * (p.x - mx);
  const wl = Math.hypot(wx, wy, wz) || 1;
  wx /= wl;
  wy /= wl;
  wz /= wl;
  const nx = dir[1] * wz - dir[2] * wy;
  const ny = dir[2] * wx - dir[0] * wz;
  const nz = dir[0] * wy - dir[1] * wx;
  const a = trails.instanceMatrix.array;
  const o = nTrails * 16;
  a[o] = dir[0] * len; a[o + 1] = dir[1] * len; a[o + 2] = dir[2] * len; a[o + 3] = 0;
  a[o + 4] = wx * w; a[o + 5] = wy * w; a[o + 6] = wz * w; a[o + 7] = 0;
  a[o + 8] = nx; a[o + 9] = ny; a[o + 10] = nz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
  color.toArray(trails.instanceColor.array, nTrails * 3);
  trails.geometry.attributes.aData.array[nTrails * 4] = alpha;
  nTrails++;
}

// ---- Sound helpers ----

function muzzle(eye, dir, yaw) {
  const [r, u, f] = LOOK.ghost.muzzle;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  return [eye[0] + right[0] * r + dir[0] * f, eye[1] + u + dir[1] * f, eye[2] + right[2] * r + dir[2] * f];
}

const distanceTo = (x, z) => (self.mover ? Math.hypot(x - self.mover.x, z - self.mover.z) : 0);

// [distance, pan] as we hear a sound at (x, z), like main.js does.
function sound(kind, phase, x, z) {
  const me = self.mover;
  let d = 0;
  let pan = 0;
  if (me) {
    const dx = x - me.x;
    const dz = z - me.z;
    d = Math.hypot(dx, dz);
    const right = dx * Math.cos(look.yaw) - dz * Math.sin(look.yaw);
    pan = d > 0.5 ? Math.max(-1, Math.min(1, right / d)) : 0;
  }
  if (audio.power) return audio.power(kind, phase, d, pan);
  // Fallback to the engine wave's generic power-up sounds.
  if (phase === 'pick') audio.pickup?.(kind, d, pan);
  else if (phase === 'use') audio.use?.(kind, d, pan);
  else if (phase === 'boom') audio.explosion?.(d, pan);
}

// ---- HUD: hud's updatePowers when it exists, else a small strip here. ----
let hudEl = null;
let slotEls = [];
let statusEl = null;
const seen = []; // what the strip shows, field by field, so a frame allocates nothing
let dirty = false;
const see = (i, v) => {
  if (seen[i] !== v) dirty = true;
  seen[i] = v;
};
const LABEL = { shunt: 'SHUNT', bolt: 'BOLT', barge: 'BARGE', shock: 'SHOCK', mine: 'MINE', nitro: 'NITRO', shield: 'SHIELD' };
const keyName = (code) => (code ?? '').replace(/^Key|^Digit/, '');

function buildHud() {
  hudEl = document.createElement('div');
  hudEl.style.cssText = 'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;font:600 11px system-ui,sans-serif;color:#f2efe8;text-shadow:0 1px 2px rgba(0,0,0,.8);pointer-events:none;letter-spacing:.08em';
  statusEl = document.createElement('div');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:flex-end;gap:8px';
  slotEls = Array.from({ length: POWER_CAPACITY }, () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:56px;height:56px;box-sizing:border-box;border-radius:6px;background:rgba(21,23,28,.62);display:flex;align-items:center;justify-content:center;transition:transform 80ms';
    return el;
  });
  row.append(...slotEls);
  hudEl.append(statusEl, row);
  (document.getElementById('hud') ?? document.body).append(hudEl);
}

function hud() {
  const pw = self.pw;
  if (ui.updatePowers) {
    ui.updatePowers(pw);
    return;
  }
  if (!hudEl) return;
  const boost = Math.ceil((self.mover?.boost ?? 0) / 6) / 10;
  const slow = Math.ceil((self.mover?.slow ?? 0) / 6) / 10;
  dirty = false;
  const n = POWER_CAPACITY;
  for (let i = 0; i < n; i++) see(i, pw?.inv[i]);
  see(n, pw?.sel);
  see(n + 1, Math.ceil(pw?.shield ?? 0));
  see(n + 2, boost);
  see(n + 3, slow);
  see(n + 4, pw?.cd > 0);
  see(n + 5, bindings.use);
  see(n + 6, bindings.cycle);
  if (!dirty) return;
  slotEls.forEach((el, i) => {
    const kind = pw?.inv[i];
    const sel = kind && i === pw.sel;
    el.textContent = kind ? LABEL[kind] : '';
    el.style.color = kind ? POWER_COLORS[kind] : '';
    el.style.border = kind ? `${sel ? 2 : 1}px solid ${sel ? POWER_COLORS[kind] : 'rgba(242,239,232,.2)'}` : '1px dashed rgba(242,239,232,.2)';
    el.style.transform = sel ? 'translateY(-6px)' : '';
    el.style.opacity = pw?.cd > 0 ? '0.55' : '1';
  });
  const tags = [];
  if (pw?.shield > 0) tags.push(`<span style="color:${POWER_COLORS.shield}">SHIELD ${Math.ceil(pw.shield)}</span>`);
  if (boost > 0) tags.push(`<span style="color:${POWER_COLORS.nitro}">NITRO ${boost.toFixed(1)}</span>`);
  if (slow > 0) tags.push(`<span style="color:${POWER_COLORS.shock}">SLOWED ${slow.toFixed(1)}</span>`);
  tags.push(`<span style="opacity:.7">${keyName(bindings.use)} USE · ${keyName(bindings.cycle)} NEXT</span>`);
  statusEl.innerHTML = tags.join('  '); // constants only, never network text
}
