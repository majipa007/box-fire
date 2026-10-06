// Other players: four boxes plus a gun, tinted with their slot colour, and a
// name tag. Standing is 1.8 m tall and crouched 1.2 m, matching the hitboxes.
// Everything lives in one group the caller adds to the scene.
import * as THREE from 'three';
import { PLAYER_COLORS, STAND_HEIGHT, CROUCH_HEIGHT, HEAD_SIZE, RUN_SPEED } from '../shared/constants.js';
import { GUN_SHAPES } from './viewmodel.js';

export const charactersGroup = new THREE.Group();

const BODY_STANDING = STAND_HEIGHT - HEAD_SIZE;
const BODY_CROUCHED = CROUCH_HEIGHT - HEAD_SIZE;
const STANDING = { leg: BODY_STANDING / 2, torso: BODY_STANDING / 2 };
const CROUCHED = { leg: 0.35, torso: BODY_CROUCHED - 0.35 }; // the legs fold, the torso stays upright
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
  rig.head.scale.setScalar(HEAD_SIZE);
  rig.group.add(...rig.legs, rig.torso, rig.head, rig.gun, rig.tag);
  for (const mesh of [...rig.legs, rig.torso, rig.head, rig.gun]) mesh.castShadow = true;
  charactersGroup.add(rig.group);
  return rig;
}

function dropRig(id) {
  const rig = rigs.get(id);
  charactersGroup.remove(rig.group);
  rig.tag.material.map.dispose();
  rig.tag.material.dispose();
  rigs.delete(id);
}

// list: [{ id, x, y, z, yaw, pitch, crouch, shielded, weapon }];
// roster: id → { name, slot }.
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
    const swing = Math.sin(rig.phase) * Math.min(1, speed / RUN_SPEED) * 0.7;
    rig.legs.forEach((leg, i) => {
      leg.scale.set(0.22, d.leg, 0.22);
      leg.position.set(i ? 0.13 : -0.13, d.leg, 0);
      leg.rotation.x = i ? -swing : swing;
    });
    rig.torso.scale.set(0.5, d.torso, 0.3);
    rig.torso.position.y = d.leg + d.torso / 2;
    rig.head.position.y = d.leg + d.torso + HEAD_SIZE / 2;
    rig.head.rotation.x = p.pitch;
    const [gw, gh, gl] = GUN_SHAPES[p.weapon] ?? GUN_SHAPES.rifle;
    rig.gun.scale.set(gw * 1.6, gh * 1.6, gl * 1.6);
    rig.gun.position.set(0.3, d.leg + d.torso * 0.8, -0.2);
    rig.gun.rotation.x = p.pitch;
    rig.tag.position.y = d.leg + d.torso + 0.55;
  }
  for (const id of rigs.keys()) if (!seen.has(id)) dropRig(id);
}
