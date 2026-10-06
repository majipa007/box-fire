// Short-lived visual effects. Everything lives in one group the caller adds
// to the scene.
import * as THREE from 'three';

export const effectsGroup = new THREE.Group();

// Tracers: a thin line from muzzle to impact, shown for 60 ms.
const tracerMaterial = new THREE.LineBasicMaterial({ color: '#fff1b8' });
const tracers = [];

export function addTracer(from, to) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]), tracerMaterial);
  effectsGroup.add(line);
  tracers.push({ line, until: performance.now() + 60 });
}

// Once per frame: retire what has expired.
export function updateEffects(now) {
  while (tracers.length && tracers[0].until <= now) {
    const { line } = tracers.shift();
    effectsGroup.remove(line);
    line.geometry.dispose();
  }
}
