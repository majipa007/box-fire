// The renderer and the player camera: the world pass, then the first-person
// gun pass with the depth buffer cleared.
import * as THREE from 'three';
import { sun } from './world.js';
import { viewScene, viewCamera, updateViewmodel } from './viewmodel.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.info.autoReset = false; // count both passes of a frame (reset in draw)
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
camera.rotation.order = 'YXZ';

let hfov = 90; // horizontal degrees; the vertical fov follows the aspect ratio
let renderScale = 1; // fraction of native resolution

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

export function draw() {
  renderer.info.reset();
  renderer.render(scene, camera);
  updateViewmodel(performance.now(), camera, scene, renderer); // viewmodel: follows the camera's turn, mirrors the scene's lights, prewarms its shaders
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(viewScene, viewCamera);
  renderer.autoClear = true;
}
