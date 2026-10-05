// Three.js scene: the merged static map, lights, fog and the player camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_COLORS, SKY_COLOR, PLAYER_COLORS } from '../shared/constants.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true });
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
camera.rotation.order = 'YXZ';

let hfov = 90; // horizontal degrees; the vertical fov follows the aspect ratio

export function init() {
  renderer.domElement.id = 'view';
  document.body.prepend(renderer.domElement);
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 25, 70);
  // Three.js lights are physically based: intensities near π read as "normal".
  scene.add(new THREE.HemisphereLight('#dfe8f2', '#5a5f6a', 2.4));
  const sun = new THREE.DirectionalLight('#ffffff', 2.6);
  sun.position.set(12, 30, 8);
  scene.add(sun);
  addEventListener('resize', resize);
  resize();
}

// Every map box becomes part of one merged geometry per colour, so the whole
// map costs a handful of draw calls.
export function addMap(map) {
  const byColor = new Map();
  for (const { pos, size, color } of map.boxes) {
    const g = new THREE.BoxGeometry(...size);
    g.translate(...pos);
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(g);
  }
  for (const [color, geoms] of byColor) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms), new THREE.MeshLambertMaterial({ color: MAP_COLORS[color], flatShading: true }));
    scene.add(mesh);
    geoms.forEach((g) => g.dispose());
  }
}

export function setFov(degrees) {
  hfov = degrees;
  resize();
}

function resize() {
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / camera.aspect));
  camera.updateProjectionMatrix();
}

export function setView(x, y, z, yaw, pitch) {
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0);
}

// Tracers: a thin line from muzzle to impact, shown for 60 ms.
const tracerMaterial = new THREE.LineBasicMaterial({ color: '#fff1b8' });
const tracers = [];

export function addTracer(from, to) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]), tracerMaterial);
  scene.add(line);
  tracers.push({ line, until: performance.now() + 60 });
}

export function draw() {
  const now = performance.now();
  while (tracers.length && tracers[0].until <= now) {
    const { line } = tracers.shift();
    scene.remove(line);
    line.geometry.dispose();
  }
  renderer.render(scene, camera);
}

// Other players: four boxes plus a gun, tinted with their slot colour, and
// a name tag. Standing is 1.8 m tall and crouched 1.2 m, matching the hitboxes.
const STANDING = { leg: 0.75, torso: 0.75 };
const CROUCHED = { leg: 0.35, torso: 0.55 };
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const legBox = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0); // pivots at the hip
const gunMaterial = new THREE.MeshLambertMaterial({ color: '#2b2d33' });
const slotMaterials = new Map();
const rigs = new Map(); // player id → rig

function slotMaterial(slot) {
  if (!slotMaterials.has(slot)) slotMaterials.set(slot, new THREE.MeshLambertMaterial({ color: PLAYER_COLORS[slot] }));
  return slotMaterials.get(slot);
}

// Drawn on a canvas, so a name can never become markup.
function nameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 34px system-ui, sans-serif';
  const size = Math.min(34, (34 * 240) / ctx.measureText(name).width);
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 128, 32);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  // Constant on-screen size (about 2.5% of the view height); walls still hide it.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, sizeAttenuation: false }));
  sprite.scale.set(0.12, 0.03, 1);
  return sprite;
}

function makeRig(name, slot) {
  const mat = slotMaterial(slot);
  const rig = {
    group: new THREE.Group(),
    legs: [new THREE.Mesh(legBox, mat), new THREE.Mesh(legBox, mat)],
    torso: new THREE.Mesh(unitBox, mat),
    head: new THREE.Mesh(unitBox, mat),
    gun: new THREE.Mesh(unitBox, gunMaterial),
    tag: nameTag(name),
    phase: 0,
    last: null,
  };
  rig.head.scale.setScalar(0.3);
  rig.gun.scale.set(0.08, 0.08, 0.5);
  rig.group.add(...rig.legs, rig.torso, rig.head, rig.gun, rig.tag);
  scene.add(rig.group);
  return rig;
}

function dropRig(id) {
  const rig = rigs.get(id);
  scene.remove(rig.group);
  rig.tag.material.map.dispose();
  rig.tag.material.dispose();
  rigs.delete(id);
}

// list: [{ id, x, y, z, yaw, pitch, crouch }]; roster: id → { name, slot }.
export function syncPlayers(list, roster, dt) {
  const seen = new Set();
  for (const p of list) {
    const info = roster.get(p.id);
    if (!info) continue;
    seen.add(p.id);
    const rig = rigs.get(p.id) ?? rigs.set(p.id, makeRig(info.name, info.slot)).get(p.id);
    const d = p.crouch ? CROUCHED : STANDING;
    rig.group.position.set(p.x, p.y, p.z);
    rig.group.rotation.y = p.yaw;
    // Legs swing with ground speed.
    const speed = rig.last && dt > 0 ? Math.hypot(p.x - rig.last.x, p.z - rig.last.z) / dt : 0;
    rig.last = { x: p.x, z: p.z };
    rig.phase += speed * dt * 2.5;
    const swing = Math.sin(rig.phase) * Math.min(1, speed / 5.5) * 0.7;
    rig.legs.forEach((leg, i) => {
      leg.scale.set(0.22, d.leg, 0.22);
      leg.position.set(i ? 0.13 : -0.13, d.leg, 0);
      leg.rotation.x = i ? -swing : swing;
    });
    rig.torso.scale.set(0.5, d.torso, 0.3);
    rig.torso.position.y = d.leg + d.torso / 2;
    rig.head.position.y = d.leg + d.torso + 0.15;
    rig.head.rotation.x = p.pitch;
    rig.gun.position.set(0.3, d.leg + d.torso * 0.8, -0.2);
    rig.gun.rotation.x = p.pitch;
    rig.tag.position.y = d.leg + d.torso + 0.55;
  }
  for (const id of rigs.keys()) if (!seen.has(id)) dropRig(id);
}
