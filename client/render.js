// Three.js scene: the merged static map, lights, fog and the player camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_COLORS, SKY_COLOR, PLAYER_COLORS } from '../shared/constants.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.info.autoReset = false; // count both passes of a frame (reset in draw)
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
camera.rotation.order = 'YXZ';

// Shared by the player models and the first-person gun.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const gunMaterial = new THREE.MeshLambertMaterial({ color: '#2b2d33' });

let hfov = 90; // horizontal degrees; the vertical fov follows the aspect ratio
let renderScale = 1; // fraction of native resolution
const sun = new THREE.DirectionalLight('#ffffff', 2.6);

export function init() {
  renderer.domElement.id = 'view';
  document.body.prepend(renderer.domElement);
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 25, 70);
  // Three.js lights are physically based: intensities near π read as "normal".
  scene.add(new THREE.HemisphereLight('#dfe8f2', '#5a5f6a', 2.4));
  sun.position.set(12, 30, 8);
  // One 2048 shadow map covering the arena, used only when shadows are on.
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.camera.updateProjectionMatrix();
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    geoms.forEach((g) => g.dispose());
  }
}

export function setFov(degrees) {
  hfov = degrees;
  resize();
}

export function setRenderScale(scale) {
  renderScale = scale;
  resize();
}

// Shadows are off by default; turning them on recompiles the materials.
export function setShadows(on) {
  if (renderer.shadowMap.enabled === on) return;
  renderer.shadowMap.enabled = on;
  sun.castShadow = on;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}

function resize() {
  renderer.setPixelRatio(devicePixelRatio * renderScale);
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

// First-person gun: its own scene and camera, drawn after the world with
// the depth buffer cleared, so it never clips into a wall and keeps its
// shape whatever FOV the player picks.
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
const gun = new THREE.Group();
const gunBody = new THREE.Mesh(unitBox, gunMaterial);
const flash = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: '#ffd76a' }));
const GUN_SHAPES = { rifle: [0.045, 0.06, 0.5], pistol: [0.04, 0.07, 0.2], shotgun: [0.065, 0.065, 0.46] };
const GUN_REST = new THREE.Vector3(0.2, -0.19, -0.6);
let recoilAt = -Infinity;
let flashFrames = 0;
flash.scale.setScalar(0.05);
gun.add(gunBody, flash);
gun.visible = false; // until we have spawned
viewScene.add(gun, new THREE.HemisphereLight('#ffffff', '#555555', 2.5));

export function setGun(weapon, visible) {
  gun.visible = visible;
  const [w, h, l] = GUN_SHAPES[weapon] ?? GUN_SHAPES.rifle;
  gunBody.scale.set(w, h, l);
  gunBody.position.z = -l / 2;
  flash.position.set(0, 0.01, -l - 0.05);
}

// A shot: kick the gun back and up, and flash the muzzle for two frames.
export function gunKick() {
  recoilAt = performance.now();
  flashFrames = 2;
}

export function draw() {
  const now = performance.now();
  renderer.info.reset();
  while (tracers.length && tracers[0].until <= now) {
    const { line } = tracers.shift();
    scene.remove(line);
    line.geometry.dispose();
  }
  renderer.render(scene, camera);
  const k = Math.max(0, 1 - (now - recoilAt) / 80); // eases back over 80 ms
  gun.position.set(GUN_REST.x, GUN_REST.y, GUN_REST.z + 0.06 * k * k);
  gun.rotation.x = 0.15 * k * k;
  flash.visible = flashFrames-- > 0;
  viewCamera.aspect = camera.aspect;
  viewCamera.updateProjectionMatrix();
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(viewScene, viewCamera);
  renderer.autoClear = true;
}

// Other players: four boxes plus a gun, tinted with their slot colour, and
// a name tag. Standing is 1.8 m tall and crouched 1.2 m, matching the hitboxes.
const STANDING = { leg: 0.75, torso: 0.75 };
const CROUCHED = { leg: 0.35, torso: 0.55 };
const legBox = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0); // pivots at the hip
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
  for (const mesh of [...rig.legs, rig.torso, rig.head, rig.gun]) mesh.castShadow = true;
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
    rig.group.visible = !p.shielded || Math.floor(performance.now() / 100) % 2 === 0; // protected players blink
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
