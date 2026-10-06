// The static world: sky, lights, fog and the map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_COLORS, SKY_COLOR } from '../shared/constants.js';

export const sun = new THREE.DirectionalLight('#ffffff', 2.6);

export function buildWorld(scene, map) {
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

  // Every map box becomes part of one merged geometry per colour, so the
  // whole map costs a handful of draw calls.
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
