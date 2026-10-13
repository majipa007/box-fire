// The renderer and the player camera: the world pass, then the first-person
// gun pass with the depth buffer cleared.
import * as THREE from 'three';
import { sun, configureRenderer, updateWorld, LIGHTS } from './world.js'; // world:
import { viewScene, viewCamera, updateViewmodel } from './viewmodel.js';
import { settings } from './ui.js'; // world: Low has no MSAA (the chain-link falls back to an alpha test)
import { createDynres } from './dynres.js';

export const renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low' && settings.msaa !== false, powerPreference: 'high-performance' }); // world:
renderer.info.autoReset = false; // count both passes of a frame (reset in draw)
configureRenderer(renderer); // world: the grade, exposure and shadow type
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
camera.rotation.order = 'YXZ';

let hfov = 90; // horizontal degrees; the vertical fov follows the aspect ratio
let renderScale = 1; // fraction of native resolution
let userScale = 1; // the setting; dynamic resolution stays at or below it
const dynres = createDynres();
let fovKick = 0; // feel: degrees added to hfov (Nitro)

export function init() {
  renderer.domElement.id = 'view';
  document.body.prepend(renderer.domElement);
  addEventListener('resize', resize);
  resize();
}

export function setFov(degrees) {
  hfov = degrees;
  resize();
}

export function setRenderScale(scale) {
  renderScale = userScale = scale;
  resize();
}

// Dynamic resolution, fed every frame's length while the setting is on.
export function frameTime(ms) {
  const next = dynres(ms, performance.now(), renderScale, userScale, settings.quality === 'low' ? 0.5 : 0.6);
  if (next === null) return;
  renderScale = next;
  resize();
}

export const scaleNow = () => renderScale; // for ?debug

// Turning shadows on or off recompiles the materials.
export function setShadows(on) {
  if (renderer.shadowMap.enabled === on) return;
  renderer.shadowMap.enabled = on;
  sun.castShadow = on;
  if (on) sun.shadow.needsUpdate = true; // world: re-bake the static sun shadow
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}

function resize() {
  renderer.setPixelRatio(devicePixelRatio * renderScale);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov + fovKick) / 2) / camera.aspect)); // feel: + fovKick
  camera.updateProjectionMatrix();
}

// feel: a temporary fov change (Nitro) without resizing the canvas.
export function setFovKick(deg) {
  if (deg === fovKick) return;
  fovKick = deg;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov + fovKick) / 2) / camera.aspect));
  camera.updateProjectionMatrix();
}

export function setBrightness(b) { renderer.toneMappingExposure = LIGHTS.exposure * b; } // hud:

export function setView(x, y, z, yaw, pitch, roll = 0) { // feel: roll
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, roll);
}

export function draw() {
  renderer.info.reset();
  updateWorld(performance.now(), camera); // world: far group, clouds, blades, motes
  renderer.render(scene, camera);
  updateViewmodel(performance.now(), camera, scene, renderer); // viewmodel: follows the camera's turn, mirrors the scene's lights, prewarms its shaders
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(viewScene, viewCamera);
  renderer.autoClear = true;
}
