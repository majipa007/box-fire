// Three.js scene: the merged static map, lights, fog and the player camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_COLORS, SKY_COLOR } from '../shared/constants.js';

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

export const draw = () => renderer.render(scene, camera);
