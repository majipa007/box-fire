// Other players, as voxel soldiers. Every part of every player is one
// instance of a single unit cube, and the optional outline hull is a second
// one, so all bodies together cost two draw calls. Each frame a small
// skeleton is posed per player: the legs plant their feet with a stride
// driven by ground speed, the arms reach the gun's grips by two-bone IK, and
// the head, arms and gun follow the aim pitch. Whatever the pose, the head
// tops out at the hitbox top (STAND_HEIGHT or CROUCH_HEIGHT, HEAD_SIZE tall)
// centred over the feet, so what you aim at is what the server tests.
// Also here: blob shadows, name tags, the hit flash, the firing kick, the
// spawn-protection blink and the death-shatter hook.
import * as THREE from 'three';
import { PLAYER_COLORS, STAND_HEIGHT, CROUCH_HEIGHT, HEAD_SIZE, PLAYER_WIDTH, RUN_SPEED, MAX_PLAYERS } from '../shared/constants.js';

// ─── Look: every number an art pass may tune ────────────────────────────────
// Metres, radians and milliseconds. The rig faces -z, +x is its right and y
// is up from the soles.

// Fixed paints. A part may also use 'slot' (its player's slot colour) or
// 'slotDark' (that times SLOT_DARK).
const PAINTS = {
  suit: '#4b4f58', gear: '#383b42', boot: '#26272b', visor: '#15171c', gun: '#2b2d33', gunTrim: '#4a4d54',
};
const SLOT_DARK = 0.55;

// The body. Each part is a box: `size` [w, h, d] centred `at` [x, y, z] in
// its bone's frame. Limb bones sit on their upper joint with +y pointing back
// up the limb, so limb parts hang below them; the head bone sits on the neck
// and is HEAD_SIZE tall; foot bones sit on the ankle, ANKLE above the sole;
// the gun bone sits on the right-hand grip with the barrel along -z. Gun
// parts carry a `weapon` and are drawn only while it is held.
const pair = (part) => ['L', 'R'].map((s) => ({ ...part, name: part.name + s, bone: part.bone + s }));
export const PARTS = [
  { name: 'hips', bone: 'pelvis', paint: 'suit', size: [0.36, 0.17, 0.22], at: [0, 0.01, 0] },
  { name: 'torso', bone: 'chest', paint: 'slot', size: [0.44, 0.46, 0.26], at: [0, 0.23, 0] },
  { name: 'backpack', bone: 'chest', paint: 'gear', size: [0.3, 0.32, 0.12], at: [0, 0.25, 0.19] },
  { name: 'head', bone: 'head', paint: 'suit', size: [0.22, 0.24, 0.22], at: [0, 0.12, 0] },
  { name: 'helmet', bone: 'head', paint: 'slot', size: [0.28, 0.14, 0.28], at: [0, 0.23, 0.01] },
  { name: 'visor', bone: 'head', paint: 'visor', size: [0.24, 0.07, 0.03], at: [0, 0.13, -0.12] },
  ...pair({ name: 'upperArm', bone: 'upperArm', paint: 'slot', size: [0.11, 0.32, 0.11], at: [0, -0.16, 0] }),
  ...pair({ name: 'foreArm', bone: 'foreArm', paint: 'suit', size: [0.1, 0.32, 0.1], at: [0, -0.16, 0] }),
  ...pair({ name: 'hand', bone: 'hand', paint: 'gear', size: [0.09, 0.1, 0.09], at: [0, 0, 0] }),
  ...pair({ name: 'thigh', bone: 'thigh', paint: 'slotDark', size: [0.15, 0.41, 0.16], at: [0, -0.205, 0] }),
  ...pair({ name: 'shin', bone: 'shin', paint: 'suit', size: [0.13, 0.41, 0.14], at: [0, -0.205, 0] }),
  ...pair({ name: 'boot', bone: 'foot', paint: 'boot', size: [0.15, 0.11, 0.26], at: [0, -0.025, -0.04] }),
  { name: 'rifleBody', bone: 'gun', weapon: 'rifle', paint: 'gun', size: [0.07, 0.1, 0.44], at: [0, 0.04, -0.14] },
  { name: 'rifleBarrel', bone: 'gun', weapon: 'rifle', paint: 'gun', size: [0.035, 0.035, 0.26], at: [0, 0.06, -0.49] },
  { name: 'rifleMag', bone: 'gun', weapon: 'rifle', paint: 'gunTrim', size: [0.05, 0.15, 0.07], at: [0, -0.06, -0.2] },
  { name: 'rifleStock', bone: 'gun', weapon: 'rifle', paint: 'gun', size: [0.05, 0.09, 0.2], at: [0, 0.02, 0.17] },
  { name: 'pistolSlide', bone: 'gun', weapon: 'pistol', paint: 'gun', size: [0.045, 0.06, 0.21], at: [0, 0.05, -0.07] },
  { name: 'pistolGrip', bone: 'gun', weapon: 'pistol', paint: 'gunTrim', size: [0.04, 0.11, 0.06], at: [0, -0.01, 0] },
  { name: 'shotgunBody', bone: 'gun', weapon: 'shotgun', paint: 'gun', size: [0.075, 0.1, 0.36], at: [0, 0.04, -0.1] },
  { name: 'shotgunBarrel', bone: 'gun', weapon: 'shotgun', paint: 'gun', size: [0.05, 0.05, 0.36], at: [0, 0.07, -0.44] },
  { name: 'shotgunPump', bone: 'gun', weapon: 'shotgun', paint: 'gunTrim', size: [0.07, 0.06, 0.16], at: [0, 0.015, -0.3] },
  { name: 'shotgunStock', bone: 'gun', weapon: 'shotgun', paint: 'gun', size: [0.06, 0.1, 0.2], at: [0, 0.01, 0.17] },
];

// Per weapon: where the gun bone sits from the aim pivot (between the
// shoulders) at zero pitch, the torso's stance twist, each hand's grip and
// the muzzle in gun space, and the firing kick as [back, lift].
export const GUNS = {
  rifle: { hold: [0.08, -0.14, -0.2], twist: -0.35, left: [0, -0.01, -0.3], right: [0, -0.02, 0], muzzle: [0, 0.06, -0.62], kick: [0.06, 0.1] },
  pistol: { hold: [0.03, -0.08, -0.42], twist: 0, left: [-0.03, -0.05, 0.02], right: [0, -0.02, 0], muzzle: [0, 0.05, -0.18], kick: [0.04, 0.25] },
  shotgun: { hold: [0.08, -0.14, -0.2], twist: -0.35, left: [0, -0.02, -0.3], right: [0, -0.02, 0], muzzle: [0, 0.07, -0.62], kick: [0.1, 0.18] },
};

// The skeleton. The pelvis height is derived, never set: the hips sit just
// low enough, and far enough back, that the head tops out on the hitbox,
// centred over the feet, whatever the lean.
const WAIST = 0.08; // pelvis pivot → chest bone
const NECK = 0.52; // chest bone → neck
const SHOULDER = [0.27, 0.4]; // [x, y] of the shoulder joints on the chest; the aim pivot is between them
const HIP = [0.1, 0.05]; // [x, drop] of the hip joints from the pelvis pivot
const ARM = [0.32, 0.32]; // upper arm, forearm
const LEG = [0.41, 0.41]; // thigh, shin
const ANKLE = 0.08; // ankle above the sole
const FOOT_X = 0.11; // each foot's x, standing
const LEAN_STAND = 0.06; // forward lean standing…
const LEAN_CROUCH = 0.55; // …crouched…
const LEAN_RUN = 0.12; // …and added at full forward speed (backpedalling leans back)
const CROUCH_FEET = [[-0.13, -0.16], [0.13, 0.36]]; // [x, z] of each ankle crouched (left, right)
const KNEE_POLE = [0, 0, -1]; // knees bend toward this standing…
const KNEE_POLE_CROUCH = [[0, 0, -1], [0, -0.5, -1]]; // …and these crouched (left, right)
const ELBOW_POLE = [0.6, -1, 0.3]; // the right elbow bends toward this; the left mirrors it
const HEAD_PITCH = 0.6; // share of the aim pitch the head nods with…
const HEAD_PITCH_MAX = 0.6; // …up to this

// Motion. Amounts are at run speed and scale down with ground speed.
const STRIDE = 0.42; // each foot swings this far either side of its rest
const STRIDE_SIDE = 0.55; // share of the stride when strafing
const LIFT = 0.16; // foot lift mid-swing
const BOB = 0.035; // pelvis bob, twice a stride
const TWIST = 0.15; // shoulders counter-twisting the stride
const SWAY = 0.08; // gun roll with the stride
const TUCK = 0.22; // feet pulled up in the air
const AIR_GAP = 0.06; // soles this far above the ground count as airborne
const SMOOTH_VELOCITY = 0.08; // seconds to ~63% of a change, per signal
const SMOOTH_CROUCH = 0.03; // short: the hitbox itself drops at once
const SMOOTH_AIR = 0.05;

// Feedback.
const FLASH_MS = 60; // a hit turns the whole player this colour…
const FLASH_COLOR = '#ffffff';
const FLASH_BOOST = 2.5; // …this bright (over 1 saturates the lit faces too)
const KICK_MS = 110; // the firing kick eases back over this
const PROTECT_COLOR = '#ffffff'; // spawn-protected players blink toward this…
const PROTECT_BLINK = 0.7; // …this far…
const PROTECT_HZ = 5; // …this often
const FOG = false; // players ignore fog, so they read at any range

// Outline hull: an unlit, inside-out copy of every part, grown on each axis.
const OUTLINE = true;
const OUTLINE_GROW = 0.04;
const OUTLINE_COLOR = '#0d0e11';
const OUTLINE_SLOT_MIX = 0; // 0 plain OUTLINE_COLOR … 1 the slot colour

// Blob shadows, shrinking and fading as a player rises above the ground.
const BLOB_SIZE = 0.95;
const BLOB_DARKNESS = 0.5;
const BLOB_FADE_HEIGHT = 2.5; // gone this high up
const BLOB_LIFT = 0.015;

// Name tags: a constant on-screen size, hidden by walls.
const TAG_LIFT = 0.32; // above the head
const TAG_SCALE = [0.12, 0.03]; // share of the view height
const TAG_FONT = 'system-ui, sans-serif';
const TAG_FILL = '#ffffff';
const TAG_STROKE = 'rgba(0, 0, 0, 0.7)';

// Death shatter.
const SHATTER_VOXEL = 0.15; // parts split into voxels at most this big a side
const SHATTER_HIDE_MS = 1000; // a shattered player stays hidden at least this long

// ─── Engine ─────────────────────────────────────────────────────────────────

export const charactersGroup = new THREE.Group();

const BONES = ['pelvis', 'chest', 'head', 'gun', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const B = Object.fromEntries(BONES.map((name, i) => [name, i]));
const bones = BONES.map(() => new THREE.Matrix4()); // the rig being posed, rig space then world

const parts = PARTS.map((p) => ({
  ...p,
  bone: B[p.bone],
  offset: new THREE.Matrix4().makeTranslation(...p.at),
  scale: new THREE.Vector3(...p.size),
  hull: new THREE.Vector3(...p.size).addScalar(OUTLINE_GROW),
}));
const PER_RIG = parts.filter((p) => !p.weapon).length
  + Math.max(...Object.keys(GUNS).map((w) => parts.filter((p) => p.weapon === w).length));
const CAPACITY = MAX_PLAYERS * PER_RIG;

const cube = new THREE.BoxGeometry(1, 1, 1);
const body = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ fog: FOG }), CAPACITY);
const hull = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: FOG }), CAPACITY);
// Blob shadows darken what is under them: dst × (1 − colour × alpha), so each
// instance's colour is its darkness and overlaps need no sorting.
const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
  map: blobTexture(), transparent: true, depthWrite: false, blending: THREE.SubtractiveBlending, premultipliedAlpha: true,
  toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
}), MAX_PLAYERS);
const MESHES = [body, hull, blobs];
for (const mesh of MESHES) {
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color()); // instanceColor exists from the start, so the shader never recompiles for it
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; // instanced bounds are computed once, not as players move
  mesh.visible = false;
}
body.receiveShadow = true; // world shadows fall on players; players never cast into a (static) shadow map
charactersGroup.add(body, hull, blobs);

const paints = Object.fromEntries(Object.entries(PAINTS).map(([k, hex]) => [k, new THREE.Color(hex)]));
const FLASH = new THREE.Color(FLASH_COLOR).multiplyScalar(FLASH_BOOST);
const PROTECT = new THREE.Color(PROTECT_COLOR);
const OUTLINE_C = new THREE.Color(OUTLINE_COLOR);

const rigs = new Map(); // player id → rig
let frame = 0; // syncPlayers calls so far; a rig drawn in the latest has seen === frame

// Scratch objects, so the per-frame path never allocates.
const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _end = new THREE.Vector3();
const _d = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _joint = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

const lerp = (a, b, t) => a + (b - a) * t;
const drawn = (rig, now) => rig.seen === frame && now >= rig.hiddenUntil;

// Once per frame. list: [{ id, x, y, z, yaw, pitch, crouch, shielded, weapon }]
// of the players to draw; roster: id → { name, slot }; dt: seconds since the
// last frame; boxes: the prepared map's boxes, for the ground under each player.
export function syncPlayers(list, roster, dt, boxes) {
  const now = performance.now();
  frame++;
  let n = 0;
  let shadows = 0;
  for (const p of list) {
    const info = roster.get(p.id);
    if (!info) continue;
    let rig = rigs.get(p.id);
    if (!rig) rigs.set(p.id, (rig = makeRig()));
    if (rig.name !== info.name || rig.slot !== info.slot) dress(rig, info);
    if (now < rig.hiddenUntil || n + PER_RIG > CAPACITY) continue;
    animate(rig, p, dt, rig.seen !== frame - 1, boxes);
    rig.seen = frame;
    rig.p = p;
    pose(rig, p, now);
    n = drawRig(rig, p, now, n);
    shadows = drawBlob(rig, p, shadows);
    rig.tag.position.set(p.x, p.y + lerp(STAND_HEIGHT, CROUCH_HEIGHT, rig.crouch) + TAG_LIFT, p.z);
  }
  for (const [id, rig] of rigs) {
    rig.tag.visible = rig.seen === frame;
    if (!roster.has(id)) {
      dropTag(rig.tag);
      rigs.delete(id);
    }
  }
  body.count = hull.count = n;
  blobs.count = shadows;
  body.visible = n > 0;
  hull.visible = OUTLINE && n > 0;
  blobs.visible = shadows > 0;
  for (const mesh of MESHES) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}

// A hit landed on this player: flash them white.
export function hitFlash(id) {
  const rig = rigs.get(id);
  if (rig) rig.flashUntil = performance.now() + FLASH_MS;
}

// This player fired: kick their gun. When `muzzle` (a THREE.Vector3) is given
// it is set to their muzzle's world position, for tracers and flashes.
// Returns false when the player is not on screen (muzzle left untouched).
export function fireKick(id, muzzle) {
  const rig = rigs.get(id);
  if (!rig) return false;
  const now = performance.now();
  const shown = drawn(rig, now);
  if (shown && muzzle) {
    pose(rig, rig.p, now);
    muzzle.fromArray(GUNS[rig.weapon].muzzle).applyMatrix4(bones[B.gun]);
  }
  rig.kickAt = now;
  return shown;
}

// This player died: hide them now (for at least SHATTER_HIDE_MS) and return
// their body as world-space boxes for effects to explode, each part split
// into voxels at most `voxel` a side (Infinity: one box per part). Each is
// { part, position, quaternion, scale, color, velocity }: the part's name,
// the box centre, its rotation, its size in metres on its own axes, its
// linear colour and the player's velocity in m/s, all fresh THREE objects.
// Empty when the player is not on screen.
export function shatter(id, voxel = SHATTER_VOXEL) {
  const rig = rigs.get(id);
  const now = performance.now();
  if (!rig || !drawn(rig, now)) return [];
  pose(rig, rig.p, now);
  rig.hiddenUntil = now + SHATTER_HIDE_MS;
  const cubes = [];
  parts.forEach((part, i) => {
    if (part.weapon && part.weapon !== rig.weapon) return;
    _m.multiplyMatrices(bones[part.bone], part.offset).decompose(_v, _quat, _scale);
    const [w, h, d] = part.size;
    const [nx, ny, nz] = part.size.map((s) => Math.max(1, Math.ceil(s / voxel - 1e-6)));
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let iz = 0; iz < nz; iz++) {
          cubes.push({
            part: part.name,
            position: new THREE.Vector3(((ix + 0.5) / nx - 0.5) * w, ((iy + 0.5) / ny - 0.5) * h, ((iz + 0.5) / nz - 0.5) * d).applyMatrix4(_m),
            quaternion: _quat.clone(),
            scale: new THREE.Vector3(w / nx, h / ny, d / nz),
            color: rig.colors[i].clone(),
            velocity: new THREE.Vector3(rig.vx, rig.vy, rig.vz),
          });
        }
      }
    }
  });
  return cubes;
}

function makeRig() {
  return {
    name: null, slot: null, tag: null, colors: parts.map(() => new THREE.Color()), outline: new THREE.Color(),
    p: null, weapon: 'rifle', seen: -1, hiddenUntil: 0, flashUntil: 0, kickAt: -Infinity,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: 0,
    crouch: 0, air: 0, run: 0, forward: 0, dirX: 0, dirZ: -1, phase: 0, swing: 0, lift: 0,
  };
}

// Colours and name tag for whoever the rig is now; redone only on a change.
function dress(rig, { name, slot }) {
  const own = new THREE.Color(PLAYER_COLORS[slot] ?? '#808080');
  parts.forEach((part, i) => {
    if (part.paint === 'slot') rig.colors[i].copy(own);
    else if (part.paint === 'slotDark') rig.colors[i].copy(own).multiplyScalar(SLOT_DARK);
    else rig.colors[i].copy(paints[part.paint]);
  });
  rig.outline.copy(OUTLINE_C).lerp(own, OUTLINE_SLOT_MIX);
  if (rig.name !== name) {
    if (rig.tag) dropTag(rig.tag);
    rig.tag = nameTag(name);
    charactersGroup.add(rig.tag);
  }
  rig.name = name;
  rig.slot = slot;
}

// Advance a rig's smoothed state to this frame. `fresh`: it was not drawn
// last frame (just joined, respawned or un-hidden), so snap rather than blend.
function animate(rig, p, dt, fresh, boxes) {
  rig.weapon = GUNS[p.weapon] ? p.weapon : 'rifle';
  rig.ground = groundBelow(p, boxes);
  const air = p.y - rig.ground > AIR_GAP ? 1 : 0;
  if (fresh) {
    rig.vx = rig.vy = rig.vz = 0;
    rig.crouch = p.crouch ? 1 : 0;
    rig.air = air;
  } else if (dt > 0) {
    const h = Math.min(dt, 0.1);
    const k = 1 - Math.exp(-h / SMOOTH_VELOCITY);
    rig.vx += ((p.x - rig.x) / dt - rig.vx) * k;
    rig.vy += ((p.y - rig.y) / dt - rig.vy) * k;
    rig.vz += ((p.z - rig.z) / dt - rig.vz) * k;
    rig.crouch += ((p.crouch ? 1 : 0) - rig.crouch) * (1 - Math.exp(-h / SMOOTH_CROUCH));
    rig.air += (air - rig.air) * (1 - Math.exp(-h / SMOOTH_AIR));
  }
  rig.x = p.x;
  rig.y = p.y;
  rig.z = p.z;
  // Ground speed in the rig's own frame drives the stride. The phase moves
  // at the rate that keeps a planted foot still on the ground.
  const cos = Math.cos(p.yaw);
  const sin = Math.sin(p.yaw);
  const lx = rig.vx * cos - rig.vz * sin;
  const lz = rig.vx * sin + rig.vz * cos;
  const speed = Math.hypot(lx, lz);
  if (speed > 0.1) {
    rig.dirX = lx / speed;
    rig.dirZ = lz / speed;
  }
  rig.run = Math.min(1, speed / RUN_SPEED);
  rig.forward = Math.max(-1, Math.min(1, -lz / RUN_SPEED));
  const grounded = 1 - rig.air;
  const reach = STRIDE * Math.sqrt(rig.run) * lerp(STRIDE_SIDE, 1, Math.abs(rig.dirZ));
  if (reach > 0.01 && dt > 0) rig.phase = (rig.phase + (Math.PI * speed * Math.min(dt, 0.1) * grounded) / (2 * reach)) % (2 * Math.PI);
  rig.swing = reach * grounded;
  rig.lift = LIFT * Math.sqrt(rig.run) * grounded;
}

// Pose the skeleton into `bones`, in world space.
function pose(rig, p, now) {
  const gun = GUNS[rig.weapon];
  const move = rig.run * (1 - rig.air);
  const spine = WAIST + NECK;
  const lean = lerp(LEAN_STAND, LEAN_CROUCH, rig.crouch) + LEAN_RUN * rig.forward * (1 - rig.air);
  const top = lerp(STAND_HEIGHT, CROUCH_HEIGHT, rig.crouch);
  bones[B.pelvis].makeRotationX(-lean)
    .setPosition(0, top - HEAD_SIZE - spine * Math.cos(lean) + BOB * move * Math.cos(2 * rig.phase), spine * Math.sin(lean));
  // Chest: up the waist, turned into the weapon's stance and against the stride.
  _m.makeRotationY(gun.twist + TWIST * move * Math.sin(rig.phase)).setPosition(0, WAIST, 0);
  bones[B.chest].multiplyMatrices(bones[B.pelvis], _m);
  // Head: level on the neck, nodding with the aim.
  _v.set(0, NECK, 0).applyMatrix4(bones[B.chest]);
  bones[B.head].makeRotationX(Math.max(-HEAD_PITCH_MAX, Math.min(HEAD_PITCH_MAX, p.pitch * HEAD_PITCH))).setPosition(_v);
  // Gun: pivots between the shoulders with the full aim pitch, kicks back and
  // up after a shot and rolls with the stride.
  const t = (now - rig.kickAt) / KICK_MS;
  const kick = t >= 0 && t < 1 ? (1 - t) ** 2 : 0;
  _v.set(0, SHOULDER[1], 0).applyMatrix4(bones[B.chest]);
  bones[B.gun].makeRotationX(p.pitch).setPosition(_v);
  _m.makeRotationFromEuler(_e.set(gun.kick[1] * kick, 0, SWAY * move * Math.sin(rig.phase)))
    .setPosition(gun.hold[0], gun.hold[1], gun.hold[2] + gun.kick[0] * kick);
  bones[B.gun].multiply(_m);
  arm(-1, gun.left, B.upperArmL);
  arm(1, gun.right, B.upperArmR);
  leg(rig, 0, B.thighL);
  leg(rig, 1, B.thighR);
  _world.makeRotationY(p.yaw).setPosition(p.x, p.y, p.z);
  for (const bone of bones) bone.premultiply(_world);
}

// An arm reaches from its shoulder to its grip on the gun; the hand takes the gun's angle.
function arm(side, grip, i) {
  _a.set(side * SHOULDER[0], SHOULDER[1], 0).applyMatrix4(bones[B.chest]);
  _t.fromArray(grip).applyMatrix4(bones[B.gun]);
  _pole.set(side * ELBOW_POLE[0], ELBOW_POLE[1], ELBOW_POLE[2]);
  limb(_a, _t, ARM[0], ARM[1], _pole, bones[i], bones[i + 1], _end);
  bones[i + 2].copy(bones[B.gun]).setPosition(_end);
}

// A leg plants its foot: at rest under the hip (or in the crouch stance),
// swung along the direction of travel, lifted mid-swing, tucked in the air.
function leg(rig, s, i) {
  const side = s ? 1 : -1;
  const c = rig.crouch;
  const ph = rig.phase + s * Math.PI;
  const swing = rig.swing * Math.cos(ph);
  _a.set(side * HIP[0], -HIP[1], 0).applyMatrix4(bones[B.pelvis]);
  _t.set(
    lerp(side * FOOT_X, CROUCH_FEET[s][0], c) + rig.dirX * swing,
    ANKLE + rig.lift * Math.max(0, -Math.sin(ph)) + TUCK * rig.air,
    lerp(0, CROUCH_FEET[s][1], c) + rig.dirZ * swing,
  );
  _pole.fromArray(KNEE_POLE).lerp(_q.fromArray(KNEE_POLE_CROUCH[s]), c);
  limb(_a, _t, LEG[0], LEG[1], _pole, bones[i], bones[i + 1], _end);
  bones[i + 2].makeTranslation(_end.x, _end.y, _end.z); // boots stay level
}

// Two-bone IK in rig space: from joint `a` toward target `t`, bending toward
// `pole`. Writes the upper and lower bones (origin on their joint, +y back up
// the limb) and the end point actually reached.
function limb(a, t, l1, l2, pole, upper, lower, end) {
  _d.subVectors(t, a);
  const dist = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(l1 + l2 - 1e-4, _d.length()));
  _d.normalize();
  const cos = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  _bend.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _joint.copy(a).addScaledVector(_d, l1 * cos).addScaledVector(_bend, l1 * Math.sqrt(Math.max(0, 1 - cos * cos)));
  end.copy(a).addScaledVector(_d, dist);
  boneAlong(a, _joint, pole, upper);
  boneAlong(_joint, end, pole, lower);
}

function boneAlong(from, to, pole, out) {
  _y.subVectors(from, to).normalize();
  _x.crossVectors(pole, _y).normalize();
  _z.crossVectors(_x, _y);
  out.makeBasis(_x, _y, _z).setPosition(from);
}

function drawRig(rig, p, now, n) {
  const flash = now < rig.flashUntil;
  const blink = p.shielded && Math.sin((now * PROTECT_HZ * 2 * Math.PI) / 1000) > 0 ? PROTECT_BLINK : 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.weapon && part.weapon !== rig.weapon) continue;
    _m.multiplyMatrices(bones[part.bone], part.offset);
    body.setMatrixAt(n, _s.copy(_m).scale(part.scale));
    hull.setMatrixAt(n, _s.copy(_m).scale(part.hull));
    body.setColorAt(n, flash ? FLASH : blink ? _c.copy(rig.colors[i]).lerp(PROTECT, blink) : rig.colors[i]);
    hull.setColorAt(n, blink ? _c.copy(rig.outline).lerp(PROTECT, blink) : rig.outline);
    n++;
  }
  return n;
}

function drawBlob(rig, p, i) {
  const fade = 1 - (p.y - rig.ground) / BLOB_FADE_HEIGHT;
  if (!(fade > 0)) return i; // too high, or nothing below
  const size = BLOB_SIZE * (0.5 + 0.5 * Math.min(1, fade));
  blobs.setMatrixAt(i, _s.makeScale(size, 1, size).setPosition(p.x, rig.ground + BLOB_LIFT, p.z));
  blobs.setColorAt(i, _c.setScalar(BLOB_DARKNESS * Math.min(1, fade)));
  return i + 1;
}

// Top of the highest map box under a player's footprint (as collision sees
// it, so a player on a crate's edge stands on it), at or below their soles;
// -Infinity over nothing. Without boxes, wherever they stand.
function groundBelow(p, boxes) {
  if (!boxes) return p.y;
  const r = PLAYER_WIDTH / 2;
  let top = -Infinity;
  for (const { min, max } of boxes) {
    if (p.x + r > min[0] && p.x - r < max[0] && p.z + r > min[2] && p.z - r < max[2] && max[1] <= p.y + 0.05 && max[1] > top) top = max[1];
  }
  return top;
}

// Soft round alpha, white, generated so nothing needs a canvas.
function blobTexture() {
  const n = 32;
  const data = new Uint8Array(n * n * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = Math.max(0, 1 - Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2));
      data[(y * n + x) * 4 + 3] = 255 * a * a * (3 - 2 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Drawn on a canvas, so a name can never become markup.
function nameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold 34px ${TAG_FONT}`;
  const size = Math.min(34, (34 * 240) / ctx.measureText(name).width);
  ctx.font = `bold ${size}px ${TAG_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = TAG_STROKE;
  ctx.strokeText(name, 128, 32);
  ctx.fillStyle = TAG_FILL;
  ctx.fillText(name, 128, 32);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  // ponytail: one sprite (one draw) per tag; an atlas on instanced quads if draws get tight.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthWrite: false, sizeAttenuation: false, fog: false }));
  sprite.scale.set(TAG_SCALE[0], TAG_SCALE[1], 1);
  return sprite;
}

function dropTag(tag) {
  charactersGroup.remove(tag);
  tag.material.map.dispose();
  tag.material.dispose();
}
