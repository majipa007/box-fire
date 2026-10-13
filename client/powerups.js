// Power-up visuals and HUD: the pads and their floating pickups, Shunts,
// Bolts and Mines, blasts, shield bubbles and nitro glows on other players,
// and a slot strip at the bottom of the screen. It is 4 instanced draws in
// all (gems, pads, glows, bubbles), rewritten in place every frame, so the
// frame loop allocates nothing.
//   init(scene, mapId) once the map is loaded; onSnapshot(m) per snapshot;
//   onEvent(m, myId) per event; update(now, visible) per frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { POWERS, POWER_CAPACITY as POWERUP_SLOTS, POWER_PADS, TICK_RATE, STAND_HEIGHT, CROUCH_HEIGHT } from '../shared/constants.js';
import { createPowers } from '../shared/powerups.js';
import { POWER_IDS } from '../shared/protocol.js';
import { self, renderTick, serverTick } from './net.js';
import { bindings } from './input.js';

// ---- Look: every colour, size, timing and count, for the art pass. ----
// Placeholder colours, one per kind: Blur's code where it has one.
const KIND_COLORS = { nitro: '#36d97a', shield: '#38c6ff', shunt: '#ff3d3d', bolt: '#4b6bff', barge: '#b25cff', mine: '#ff9a1f', shock: '#ffb300' };
const KIND_LABELS = { nitro: 'Nitro', shield: 'Shield', shunt: 'Shunt', bolt: 'Bolt', barge: 'Barge', mine: 'Mine', shock: 'Shock' };
// Gems (pickups, projectiles, mines) are unlit octahedra with shading baked
// per face: this light direction, and this floor for faces turned away.
const GEM_LIGHT = new THREE.Vector3(0.4, 1, 0.3).normalize();
const GEM_SHADE_MIN = 0.45;
// Pads: a dark plate with a ring of the kind's colour round its edge.
const PAD_RADIUS = 0.85; // m
const PAD_THICKNESS = 0.05; // m
const PAD_RING_WIDTH = 0.1; // m
const PAD_PLATE_SHADE = 0.22; // the plate, as a fraction of the ring's colour
const PAD_EMPTY_SHADE = 0.3; // the whole pad while it refills
// Pickups: a spinning, bobbing gem with a glow round it.
const PICKUP_SIZE = 0.5; // m tall
const PICKUP_WIDTH = 0.8; // width / height
const PICKUP_HOVER = 1.0; // m above the pad
const PICKUP_BOB = 0.08; // m up and down
const PICKUP_BOB_HZ = 0.6;
const PICKUP_SPIN_HZ = 0.3;
const PICKUP_GLOW = 1.6; // m across
const PICKUP_GLOW_ALPHA = 0.7;
const PICKUP_PHASE_STEP = 1.7; // radians of bob and spin between one pad and the next
const PICKUP_REGROW = 1; // s: the gem grows back over the last second of a refill
// Projectiles: a gem stretched along the flight, a glow and a fading trail.
const SHOT_SIZE = { shunt: 0.3, bolt: 0.18 }; // m wide
const SHOT_STRETCH = 2.5; // length / width
const SHOT_GLOW = { shunt: 1.4, bolt: 0.9 }; // m across
const SHOT_GLOW_ALPHA = 0.9;
const TRAIL_COUNT = 6; // glows behind each projectile
const TRAIL_STEP = 0.025; // s of flight between two of them
const TRAIL_FADE = 0.75; // each is this much smaller and dimmer than the one before
// Mines: a flat gem on a pool of light; both blink once it is armed.
const MINE_SIZE = 0.45; // m across
const MINE_FLAT = 0.3; // height / width
const MINE_SPIN_HZ = 0.25;
const MINE_GLOW = 1.4; // m across, the pool of light on the floor
const MINE_IDLE_ALPHA = 0.25; // pool before it arms
const MINE_BLINK_HZ = 2.5;
const MINE_BLINK_LOW = 0.3; // pool and gem brightness between blinks
// Blasts: a flash and an expanding shell, drawn as a camera-facing ring.
// Barge instead sends a flat ring out across the floor from the user's feet.
const BLAST_SECONDS = 0.45;
const BLAST_MIN_RADIUS = 0.8; // m, for kinds without splash (Bolt)
const BLAST_FLASH = 1.2; // flash size, times the blast diameter
const BLAST_FLASH_MAX = 4; // m across, so a big blast never floods the screen
const BLAST_RING_INNER = 0.8; // ring thickness: inner edge as a fraction of the outer
const BARGE_RING_SECONDS = 0.5;
const BARGE_RING_INNER = 0.88;
// Puffs: the small flash where a power-up is picked up, or used by someone else.
const PUFF_SECONDS = 0.35;
const PUFF_SIZE = 2.2; // m across
const PUFF_HEIGHT = 0.9; // m above the user's feet
// On other players.
const BUBBLE_RADIUS = 1.1; // m, centred on the body
const BUBBLE_ALPHA = 0.85;
const BUBBLE_RIM = 2.5; // fresnel exponent: higher makes a thinner rim
const NITRO_GLOW = 1.6; // m across, a pool of light under a boosted player
const NITRO_GLOW_ALPHA = 0.6;
// HUD.
const HUD_SLOT_PX = 44;
const HUD_FIRST_PX = 56; // the slot that fires next
const HUD_BOTTOM_PX = 16;
const HUD_GAP_PX = 6;
const HUD_RADIUS_PX = 8;
const HUD_FONT = '600 11px system-ui, sans-serif';
const HUD_BG = 'rgba(0, 0, 0, 0.35)';
const HUD_EMPTY = 'rgba(255, 255, 255, 0.22)'; // border of an empty slot
const HUD_GLOW_PX = 10; // a full slot glows in its colour
// Capacities: the most instances drawn per frame.
const MAX_GEMS = 96;
const MAX_GLOWS = 512;
const MAX_BUBBLES = 16;
const MAX_FX = 32; // blasts and puffs alive at once

const COLORS = Object.fromEntries(Object.entries(KIND_COLORS).map(([k, c]) => [k, new THREE.Color(c)]));
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;

// Additive quads. aShape 0 is a soft round glow facing the camera; a value
// in (0, 1) is a ring whose inner edge sits at that fraction of the radius.
// Add FLAT (2) to lay either one on the floor, facing up: a glow there is
// a pool of light that never gets cut off by the floor it sits on.
const GLOW_VERTEX = /* glsl */ `
attribute float aShape;
varying vec3 vColor;
varying vec2 vUv;
varying float vShape;
void main() {
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  vUv = uv * 2.0 - 1.0;
  bool lying = aShape >= 2.0; // ("flat" is a GLSL keyword)
  vShape = lying ? aShape - 2.0 : aShape;
  vec3 center = instanceMatrix[3].xyz;
  float size = instanceMatrix[0].x;
  vec4 mv;
  if (lying) {
    mv = modelViewMatrix * vec4(center + vec3(position.x, 0.0, -position.y) * size, 1.0);
  } else {
    mv = modelViewMatrix * vec4(center, 1.0);
    mv.xy += position.xy * size;
  }
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
varying float vShape;
void main() {
  float r = length(vUv);
  float a;
  if (vShape > 0.0) {
    float halfWidth = (1.0 - vShape) * 0.5;
    a = 1.0 - smoothstep(0.0, halfWidth, abs(r - (1.0 - halfWidth)));
  } else {
    a = max(1.0 - r, 0.0);
  }
  gl_FragColor = vec4(vColor, a * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Additive fresnel shells.
const BUBBLE_VERTEX = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vNormal = normalMatrix * mat3(instanceMatrix) * normal;
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const BUBBLE_FRAGMENT = /* glsl */ `
uniform float uAlpha;
uniform float uRim;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uRim);
  gl_FragColor = vec4(vColor, rim * uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Unlit octahedron, 1 m tall and wide, with its face shading baked in.
function gemGeometry() {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  const pos = g.attributes.position;
  const shade = new Float32Array(pos.count * 3);
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1).sub(a);
    c.fromBufferAttribute(pos, i + 2).sub(a);
    const s = GEM_SHADE_MIN + (1 - GEM_SHADE_MIN) * Math.max(0, b.cross(c).normalize().dot(GEM_LIGHT));
    shade.fill(s, i * 3, i * 3 + 9);
  }
  g.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  return g;
}

// A plate on the floor with a bright ring on top, 1 m = PAD_RADIUS.
function padGeometry() {
  const shade = (g, s) => g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(s), 3));
  const plate = new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, PAD_THICKNESS, 32).translate(0, PAD_THICKNESS / 2, 0);
  const ring = new THREE.RingGeometry(PAD_RADIUS - PAD_RING_WIDTH, PAD_RADIUS, 32).rotateX(-Math.PI / 2).translate(0, PAD_THICKNESS + 0.002, 0);
  shade(plate, PAD_PLATE_SHADE);
  shade(ring, 1);
  return mergeGeometries([plate, ring]);
}

function instanced(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Made before the first draw: instance colours are a compile-time switch.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // instances span the arena; the bounds would go stale
  mesh.count = 0;
  return mesh;
}

const group = new THREE.Group();
let padMesh = null;
let gemMesh = null;
let glowMesh = null;
let bubbleMesh = null;
let shapes = null; // glowMesh's aShape attribute
let pads = []; // { x, y, z, kind, color, phase } per pad of this map
let padState = []; // newest from the server: 0 when ready, else the tick it refills
const snaps = []; // { tick, list: [entity], byId: Map id → entity }, oldest first
const FLAT = 2; // glow shape offset: lying on the floor
const FLASH = 0;
const SHELL = 1; // a flash plus an expanding camera-facing ring
const FLOOR = 2; // a ring spreading flat across the floor
const fx = Array.from({ length: MAX_FX }, () => ({ until: 0, start: 0, x: 0, y: 0, z: 0, size: 0, color: null, mode: FLASH }));
let fxNext = 0;
let gems = 0;
let glows = 0;
let bubbles = 0;
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const scale = new THREE.Vector3();
const dir = new THREE.Vector3();
const tint = new THREE.Color();

export function init(scene, mapId) {
  const gemMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  gemMesh = instanced(gemGeometry(), gemMaterial, MAX_GEMS);
  pads = POWER_PADS.map(({ pos: [x, y, z], pool: [kind] }, i) => ({ x, y, z, kind, color: COLORS[kind], phase: i * PICKUP_PHASE_STEP }));
  padMesh = instanced(padGeometry(), gemMaterial, Math.max(1, pads.length));
  pads.forEach((p, i) => padMesh.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  padMesh.count = pads.length;
  const glowGeometry = new THREE.PlaneGeometry(1, 1);
  shapes = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOWS), 1).setUsage(THREE.DynamicDrawUsage);
  glowGeometry.setAttribute('aShape', shapes);
  glowMesh = instanced(glowGeometry, new THREE.ShaderMaterial({
    vertexShader: GLOW_VERTEX, fragmentShader: GLOW_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), MAX_GLOWS);
  bubbleMesh = instanced(new THREE.IcosahedronGeometry(1, 2), new THREE.ShaderMaterial({
    vertexShader: BUBBLE_VERTEX, fragmentShader: BUBBLE_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAlpha: { value: BUBBLE_ALPHA }, uRim: { value: BUBBLE_RIM } },
  }), MAX_BUBBLES);
  group.add(padMesh, gemMesh, glowMesh, bubbleMesh);
  scene.add(group);
  buildHud();
}

export function onSnapshot(m) {
  if (!m.pu) return;
  padState = m.pu.pd.map(([k, ready]) => ready);
  m.pu.pd.forEach(([k], i) => { if (pads[i]) pads[i].color = COLORS[(pads[i].kind = POWER_IDS[k])]; });
  const prev = snaps.at(-1)?.byId;
  const list = [];
  for (const e of list) e.born = prev?.get(e.id)?.born ?? m.tick; // trails grow out of the launch point
  snaps.push({ tick: m.tick, list, byId: new Map(list.map((e) => [e.id, e])) });
  if (snaps.length > 8) snaps.shift();
}

export function onEvent(m, myId) {
  if (m.e === 'spawn' && m.id === myId) {
    self.pw = createPowers(); // a new life starts empty; don't predict with the last one's
  } else if (m.e === 'boom' && m.k !== 'barge') {
    const r = Math.max(BLAST_MIN_RADIUS, m.r);
    addFx(m.x, m.y, m.z, COLORS[m.k], 2 * r, SHELL, BLAST_SECONDS);
  } else if (m.e === 'pick' && pads[m.pad]) {
    const p = pads[m.pad];
    addFx(p.x, p.y + PICKUP_HOVER, p.z, p.color, PUFF_SIZE, FLASH, PUFF_SECONDS);
  } else if (m.e === 'use' && COLORS[m.k]) {
    // Our own use shows on the HUD; a flash on the camera would only blind us.
    if (m.id !== myId) addFx(m.x, m.y + PUFF_HEIGHT, m.z, COLORS[m.k], PUFF_SIZE, FLASH, PUFF_SECONDS);
    if (m.k === 'barge') addFx(m.x, m.y + 0.05, m.z, COLORS.barge, 2 * POWERS.barge.radius, FLOOR, BARGE_RING_SECONDS);
  }
}

function addFx(x, y, z, color, size, mode, seconds) {
  if (!color) return;
  const f = fx[fxNext];
  fxNext = (fxNext + 1) % MAX_FX;
  const now = performance.now();
  Object.assign(f, { x, y, z, color, size, mode, start: now, until: now + seconds * 1000 });
}

// visible: other living players, as net.js others() gives them.
export function update(now, visible) {
  if (!gemMesh) return;
  gems = 0;
  glows = 0;
  bubbles = 0;
  const s = now / 1000;
  drawPads(now, s);
  drawEntities(now, s);
  for (const f of fx) if (f.until > now) drawFx(f, now);
  for (const o of visible) {
    if (o.bubble) bubble(o.x, o.y + (o.crouch ? CROUCH_HEIGHT : STAND_HEIGHT) / 2, o.z, BUBBLE_RADIUS, COLORS.shield);
    if (o.nitro) glow(o.x, o.y + 0.03, o.z, NITRO_GLOW, COLORS.nitro, NITRO_GLOW_ALPHA, FLAT);
  }
  gemMesh.count = gems;
  glowMesh.count = glows;
  bubbleMesh.count = bubbles;
  gemMesh.visible = gems > 0; // an empty mesh still costs its state changes
  glowMesh.visible = glows > 0;
  bubbleMesh.visible = bubbles > 0;
  flush(padMesh.instanceColor, pads.length, 3);
  flush(gemMesh.instanceMatrix, gems, 16);
  flush(gemMesh.instanceColor, gems, 3);
  flush(glowMesh.instanceMatrix, glows, 16);
  flush(glowMesh.instanceColor, glows, 3);
  flush(shapes, glows, 1);
  flush(bubbleMesh.instanceMatrix, bubbles, 16);
  flush(bubbleMesh.instanceColor, bubbles, 3);
  updateHud();
}

// Upload only the instances drawn this frame.
function flush(attr, n, size) {
  if (!n) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * size);
  attr.needsUpdate = true;
}

function drawPads(now, s) {
  const tick = serverTick(now);
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const readyAt = padState[i] ?? 0;
    const left = readyAt ? (readyAt - tick) / TICK_RATE : 0;
    const grow = left <= 0 ? 1 : left < PICKUP_REGROW ? 1 - left / PICKUP_REGROW : 0;
    padMesh.setColorAt(i, tint.copy(p.color).multiplyScalar(grow === 1 ? 1 : PAD_EMPTY_SHADE));
    if (!grow) continue;
    const y = p.y + PICKUP_HOVER + Math.sin(TAU * PICKUP_BOB_HZ * s + p.phase) * PICKUP_BOB;
    q.setFromAxisAngle(UP, TAU * PICKUP_SPIN_HZ * s + p.phase);
    const h = PICKUP_SIZE * grow;
    gem(p.x, y, p.z, h * PICKUP_WIDTH, h, h * PICKUP_WIDTH, p.color);
    glow(p.x, y, p.z, PICKUP_GLOW * grow, p.color, PICKUP_GLOW_ALPHA, 0);
  }
}

// Entities are drawn at the same render tick as other players, blended
// between the two snapshots around it.
function drawEntities(now, s) {
  if (!snaps.length) return;
  const rt = renderTick(now);
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].tick > rt) i--;
  const b = snaps[i];
  const a = i > 0 && snaps[i - 1].tick <= rt ? snaps[i - 1] : b;
  const t = a === b ? 0 : Math.min(1, (rt - a.tick) / (b.tick - a.tick));
  for (let j = 0; j < b.list.length; j++) {
    const e = b.list[j];
    const from = a.byId.get(e.id) ?? e;
    const x = lerp(from.x, e.x, t);
    const y = lerp(from.y, e.y, t);
    const z = lerp(from.z, e.z, t);
    const color = COLORS[e.kind];
    if (!color) continue;
    if (e.kind === 'mine') {
      const blink = !e.armed || Math.sin(TAU * MINE_BLINK_HZ * s) > 0 ? 1 : MINE_BLINK_LOW;
      q.setFromAxisAngle(UP, TAU * MINE_SPIN_HZ * s + e.id);
      gem(x, y + (MINE_SIZE * MINE_FLAT) / 2, z, MINE_SIZE, MINE_SIZE * MINE_FLAT, MINE_SIZE, tint.copy(color).multiplyScalar(blink));
      glow(x, y + 0.02, z, MINE_GLOW, color, e.armed ? blink : MINE_IDLE_ALPHA, FLAT);
      continue;
    }
    const speed = Math.hypot(e.vx, e.vy, e.vz);
    if (!speed) continue;
    q.setFromUnitVectors(UP, dir.set(e.vx / speed, e.vy / speed, e.vz / speed));
    const w = SHOT_SIZE[e.kind] ?? 0.2;
    const size = SHOT_GLOW[e.kind] ?? 1;
    gem(x, y, z, w, w * SHOT_STRETCH, w, color);
    glow(x, y, z, size, color, SHOT_GLOW_ALPHA, 0);
    const trail = Math.min(TRAIL_COUNT, Math.floor((rt - e.born) / TICK_RATE / TRAIL_STEP));
    for (let k = 1, f = TRAIL_FADE; k <= trail; k++, f *= TRAIL_FADE) {
      glow(x - e.vx * TRAIL_STEP * k, y - e.vy * TRAIL_STEP * k, z - e.vz * TRAIL_STEP * k, size * f, color, SHOT_GLOW_ALPHA * f, 0);
    }
  }
}

function drawFx(f, now) {
  const age = Math.max(0, (now - f.start) / (f.until - f.start)); // events land mid-frame
  const fade = 1 - age;
  const spread = f.size * (1 - fade * fade * fade); // fast, then easing out
  if (f.mode === FLOOR) return glow(f.x, f.y, f.z, spread, f.color, fade, FLAT + BARGE_RING_INNER);
  const flash = f.mode === SHELL ? Math.min(BLAST_FLASH_MAX, f.size * BLAST_FLASH) : f.size;
  glow(f.x, f.y, f.z, flash * (0.4 + 0.6 * age), f.color, fade * fade, 0);
  if (f.mode === SHELL) glow(f.x, f.y, f.z, spread, f.color, fade, BLAST_RING_INNER);
}

// One gem: q is its rotation, (sx, sy, sz) its size in metres.
function gem(x, y, z, sx, sy, sz, color) {
  if (gems >= MAX_GEMS) return;
  gemMesh.setMatrixAt(gems, m4.compose(v.set(x, y, z), q, scale.set(sx, sy, sz)));
  gemMesh.setColorAt(gems, color);
  gems++;
}

// One glow quad, `size` m across, its colour scaled by alpha.
function glow(x, y, z, size, color, alpha, shape) {
  if (glows >= MAX_GLOWS) return;
  const m = glowMesh.instanceMatrix.array;
  const o = glows * 16;
  m[o] = size;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  const c = glowMesh.instanceColor.array;
  c[glows * 3] = color.r * alpha;
  c[glows * 3 + 1] = color.g * alpha;
  c[glows * 3 + 2] = color.b * alpha;
  shapes.array[glows] = shape;
  glows++;
}

function bubble(x, y, z, r, color) {
  if (bubbles >= MAX_BUBBLES) return;
  bubbleMesh.setMatrixAt(bubbles, m4.makeScale(r, r, r).setPosition(x, y, z));
  bubbleMesh.setColorAt(bubbles, color);
  bubbles++;
}

// ---- HUD: one box per slot, the next to fire biggest, plus a status line
// for an active Shield or Nitro and the keys. Text only changes when the
// state does. ----
let slotEls = [];
let statusEl = null;
let keysEl = null;
const shown = { slots: [], shield: -1, boost: -1, use: '', cycle: '' };
const keyName = (code) => code.replace(/^Key|^Digit/, '');

function buildHud() {
  const hud = document.createElement('div');
  hud.id = 'powerups';
  hud.style.cssText = `position:absolute;left:50%;bottom:${HUD_BOTTOM_PX}px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;font:${HUD_FONT};color:#fff;text-shadow:0 1px 2px #000;pointer-events:none`;
  statusEl = document.createElement('div');
  const row = document.createElement('div');
  row.style.cssText = `display:flex;align-items:flex-end;gap:${HUD_GAP_PX}px`;
  slotEls = Array.from({ length: POWERUP_SLOTS }, (_, i) => {
    const el = document.createElement('div');
    const px = i === 0 ? HUD_FIRST_PX : HUD_SLOT_PX;
    el.style.cssText = `width:${px}px;height:${px}px;box-sizing:border-box;border:2px solid ${HUD_EMPTY};border-radius:${HUD_RADIUS_PX}px;background:${HUD_BG};display:flex;align-items:center;justify-content:center;text-transform:uppercase;letter-spacing:0.03em`;
    return el;
  });
  row.append(...slotEls);
  keysEl = document.createElement('div');
  keysEl.style.opacity = '0.7';
  hud.append(statusEl, row, keysEl);
  (document.getElementById('hud') ?? document.body).append(hud);
}

function updateHud() {
  for (let i = 0; i < POWERUP_SLOTS; i++) {
    const kind = self.pw?.inv[i] ?? '';
    if (shown.slots[i] === kind) continue;
    shown.slots[i] = kind;
    const el = slotEls[i];
    el.textContent = KIND_LABELS[kind] ?? '';
    el.style.borderColor = KIND_COLORS[kind] ?? HUD_EMPTY;
    el.style.boxShadow = kind ? `0 0 ${HUD_GLOW_PX}px ${KIND_COLORS[kind]}` : 'none';
  }
  const shield = Math.ceil(self.pw?.shield ?? 0);
  const boost = Math.ceil(((self.mover?.boost ?? 0) / TICK_RATE) * 10) / 10;
  if (shield !== shown.shield || boost !== shown.boost) {
    shown.shield = shield;
    shown.boost = boost;
    statusEl.textContent = [shield > 0 ? `Shield ${shield}` : '', boost > 0 ? `Nitro ${boost.toFixed(1)} s` : ''].filter(Boolean).join('  ·  ');
  }
  if (shown.use !== bindings.use || shown.cycle !== bindings.cycle) {
    shown.use = bindings.use;
    shown.cycle = bindings.cycle;
    keysEl.textContent = `${keyName(bindings.use)} use  ·  ${keyName(bindings.cycle)} cycle`;
  }
}
