// First-person gun: its own scene and camera, drawn after the world with the
// depth buffer cleared, so it never clips into a wall and keeps its shape
// whatever FOV the player picks.
import * as THREE from 'three';

export const viewScene = new THREE.Scene();
export const viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

// Box sizes [width, height, length] per weapon; other players' guns too.
export const GUN_SHAPES = { rifle: [0.045, 0.06, 0.5], pistol: [0.04, 0.07, 0.2], shotgun: [0.065, 0.065, 0.46] };

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const gun = new THREE.Group();
const gunBody = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: '#2b2d33' }));
const flash = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: '#ffd76a' }));
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

// Once per frame, before drawing.
export function updateViewmodel(now, aspect) {
  const k = Math.max(0, 1 - (now - recoilAt) / 80); // eases back over 80 ms
  gun.position.set(GUN_REST.x, GUN_REST.y, GUN_REST.z + 0.06 * k * k);
  gun.rotation.x = 0.15 * k * k;
  flash.visible = flashFrames-- > 0;
  viewCamera.aspect = aspect;
  viewCamera.updateProjectionMatrix();
}
