// Other players, as voxel soldiers (bible §3.1). Every lit part of every
// player is one instance of a single unit cube; the outline hull, the unlit
// visors and sparks, the blob shadows, the Shield bubbles and the Nitro
// ribbons are one draw each: 6 draws for any number of players. Each frame a
// small skeleton is posed per player: the legs swing from the hips with the
// stride (feet kept on the ground), the arms reach the gun's grips by
// two-bone IK, and the head, torso, arms and gun follow the aim pitch.
// Whatever the pose, the helmet tops out at the hitbox top (STAND_HEIGHT or
// CROUCH_HEIGHT) centred over the feet, so what you aim at is what the
// server tests. Also here: the hit flash, the firing kick, spawn assembly,
// the spawn-protection pulse, name-tag positions, the Low-preset sun fallback,
// the death-shatter hook and ?debug&lineup.
import * as THREE from 'three';
import { PLAYER_COLORS, STAND_HEIGHT, CROUCH_HEIGHT, PLAYER_WIDTH, RUN_SPEED, MAX_PLAYERS } from '../shared/constants.js';
import { rayBox } from '../shared/collision.js';

const D = Math.PI / 180;

// ─── Look: every number an art pass may tune ────────────────────────────────
// Metres, radians, milliseconds. The rig faces -z, +x is its right and y is up
// from the soles.
const LOOK = {
  paints: { kit: '#24272d', boot: '#1b1d22', glove: '#3a3d44', pack: '#c7b48e', gun: '#2e3136' },
  lift: 0.35, // self-lit share of the albedo, so slot hues hold in shade
  // Bevels: every box's edges lighten (albedo × gain + add) over `width` m, so dark kit, gloves and
  // gun read as separate parts up close; they fade out between `fade` m, where the outline takes over.
  bevel: { width: [0.006, 0.016], gain: 1.6, add: 0.035, fade: [8, 20] },
  outline: { color: '#15171c', min: 0.03, perMetre: 0.0021 }, // per side: ~2 px at 1080p and 90° hfov
  blob: { radius: 0.42, darkness: 0.38, core: 0.6, lift: 0.015 }, // full darkness out to `core` × radius; shrinks by 1 / (1 + height above the ground)
  // Motion. Swing amounts are at run speed and scale with ground speed / RUN_SPEED.
  step: 2.2, // m per step, like the footstep sound: the stride phase moves π per step
  thigh: 32 * D, thighSide: 20 * D, knee: 45 * D, // swing either side, strafing swing, knee fold on the back-swing
  bob: 0.035, // pelvis dip per step
  leanRun: 5 * D, torsoPitch: 0.3, // torso: forward lean at run speed, and share of the aim pitch
  // Crouched: the bible's 30° lean puts the hips 0.31 m behind the head, far outside the 0.6 m
  // hitbox. At 14.5°, aiming level, every part but the pack is within 4 cm of its box at yaw 0°
  // and 45° (the helmet's 45° corners aside, as standing); the pack's lower edge is out ≈10 cm.
  // crouchShift moves the crouched body forward (the head with it).
  leanCrouch: 14.5 * D, crouchShift: 0,
  headPitch: 0.5, // the head takes the full aim pitch up to this, so it stays on its hitbox
  airThigh: 25 * D, airKnee: 40 * D,
  crouchMs: 100,
  twist: 0.15, sway: 0.08, // shoulders counter-twisting the stride; gun roll with it
  kick: { back: 0.05, pitch: 6 * D, ms: 90 },
  flash: { hold: 60, fade: 90, white: 0.7, scale: 1.06, flinch: 0.04 },
  spawn: { ms: 250, spread: 0.5 },
  protect: { hz: 5, white: 0.25 },
  sunFallback: { heights: [0.4, 1.0, 1.6], min: 0.62, halflife: 150 }, // shadows off: lit share from 3 rays to the sun
  bubble: { radius: 1.1, y: 0.95, yCrouch: 0.65, color: '#66fff0', alpha: [0.08, 0.6] },
  // Along the path, `apart` either side (so the strips never overlap), `height` up; full alpha for the first `hold` of the trail, then a linear fade.
  ribbon: { width: 0.35, ms: 600, alpha: 0.7, hold: 0.4, fringe: '#15171c', fringeAlpha: 0.45, height: 0.18, apart: 0.18, sampleMs: 30 },
  sparks: { count: 6, size: 0.06, color: '#ffb300', hops: 7 }, // hops per second from part to part; 6 cm, not the bible's 4, so they read past 7 m
  tags: { range: 12, cone: 4 * D, lift: 0.28, fadeMs: 120 },
  shatter: { voxel: 0.15, hideMs: 1000 },
};

// The body (bible §3.1): 26 lit boxes and an unlit visor. Each part is a box
// `size` [w, h, d] centred `at` [x, y, z] in its bone's frame. Limb bones sit
// on their upper joint with +y back up the limb, so limb parts hang below
// them; the head bone sits on the neck; foot bones sit on the ankle, ANKLE
// above the sole; the gun bone sits on the right-hand grip with the barrel
// along -z. Paint 'slot' is the player's slot colour; 'visor' is that at full
// value, unlit. `outline` parts get a hull; gun parts carry a `weapon` and are
// drawn only while it is held.
const pair = (part) => ['L', 'R'].map((s) => ({ ...part, name: part.name + s, bone: part.bone + s }));
export const PARTS = [
  { name: 'belt', bone: 'pelvis', paint: 'kit', size: [0.38, 0.12, 0.24], at: [0, 0.03, 0], outline: true },
  { name: 'torso', bone: 'chest', paint: 'slot', size: [0.4, 0.55, 0.26], at: [0, 0.275, 0], outline: true },
  { name: 'chestRig', bone: 'chest', paint: 'kit', size: [0.34, 0.22, 0.06], at: [0, 0.33, -0.15] },
  { name: 'pack', bone: 'chest', paint: 'pack', size: [0.3, 0.4, 0.14], at: [0, 0.34, 0.19], outline: true },
  { name: 'neck', bone: 'chest', paint: 'kit', size: [0.12, 0.06, 0.12], at: [0, 0.58, 0] },
  { name: 'head', bone: 'head', paint: 'kit', size: [0.26, 0.24, 0.26], at: [0, 0.13, 0], outline: true },
  { name: 'helmet', bone: 'head', paint: 'slot', size: [0.3, 0.13, 0.3], at: [0, 0.315, 0], outline: true },
  { name: 'visor', bone: 'head', paint: 'visor', size: [0.22, 0.06, 0.02], at: [0, 0.17, -0.14], unlit: true },
  ...pair({ name: 'upperArm', bone: 'upperArm', paint: 'kit', size: [0.1, 0.3, 0.11], at: [0, -0.15, 0], outline: true }),
  ...pair({ name: 'armband', bone: 'upperArm', paint: 'slot', size: [0.105, 0.06, 0.115], at: [0, -0.08, 0] }),
  ...pair({ name: 'foreArm', bone: 'foreArm', paint: 'kit', size: [0.09, 0.26, 0.1], at: [0, -0.13, 0], outline: true }),
  ...pair({ name: 'hand', bone: 'hand', paint: 'glove', size: [0.09, 0.09, 0.1], at: [0, 0, 0] }),
  ...pair({ name: 'thigh', bone: 'thigh', paint: 'kit', size: [0.17, 0.42, 0.19], at: [0, -0.21, 0], outline: true }),
  ...pair({ name: 'shin', bone: 'shin', paint: 'kit', size: [0.14, 0.36, 0.16], at: [0, -0.18, 0], outline: true }),
  ...pair({ name: 'kneePad', bone: 'shin', paint: 'slot', size: [0.15, 0.1, 0.04], at: [0, -0.04, -0.09] }),
  ...pair({ name: 'boot', bone: 'foot', paint: 'boot', size: [0.16, 0.12, 0.26], at: [0, 0.02, -0.04], outline: true }),
  { name: 'rifleReceiver', bone: 'gun', weapon: 'rifle', paint: 'gun', size: [0.06, 0.09, 0.42], at: [0, 0.05, -0.14], outline: true },
  { name: 'rifleMag', bone: 'gun', weapon: 'rifle', paint: 'gun', size: [0.04, 0.12, 0.06], at: [0, -0.05, -0.1] },
  { name: 'rifleStock', bone: 'gun', weapon: 'rifle', paint: 'gun', size: [0.05, 0.08, 0.16], at: [0, 0.03, 0.15] },
  { name: 'pistolSlide', bone: 'gun', weapon: 'pistol', paint: 'gun', size: [0.04, 0.06, 0.2], at: [0, 0.05, -0.06], outline: true },
  { name: 'pistolGrip', bone: 'gun', weapon: 'pistol', paint: 'gun', size: [0.035, 0.11, 0.05], at: [0, -0.01, 0.01] },
  { name: 'pistolGuard', bone: 'gun', weapon: 'pistol', paint: 'gun', size: [0.03, 0.03, 0.07], at: [0, 0.005, -0.06] },
  { name: 'shotgunReceiver', bone: 'gun', weapon: 'shotgun', paint: 'gun', size: [0.065, 0.09, 0.56], at: [0, 0.05, -0.18], outline: true },
  { name: 'shotgunPump', bone: 'gun', weapon: 'shotgun', paint: 'gun', size: [0.06, 0.06, 0.15], at: [0, -0.02, -0.33] },
  { name: 'shotgunStock', bone: 'gun', weapon: 'shotgun', paint: 'gun', size: [0.055, 0.1, 0.18], at: [0, 0.02, 0.18] },
];

// Per weapon: where the gun bone sits from the aim pivot (between the
// shoulders) at zero pitch, the torso's stance twist, each hand's grip and
// the muzzle in gun space.
export const GUNS = {
  rifle: { hold: [0.08, -0.14, -0.2], twist: -0.35, left: [0, -0.01, -0.29], right: [0, -0.02, 0], muzzle: [0, 0.05, -0.36] },
  pistol: { hold: [0.03, -0.08, -0.36], twist: 0, left: [-0.03, -0.04, 0.02], right: [0, -0.02, 0], muzzle: [0, 0.05, -0.17] },
  shotgun: { hold: [0.08, -0.14, -0.17], twist: -0.35, left: [0, -0.04, -0.33], right: [0, -0.02, 0], muzzle: [0, 0.05, -0.47] },
};

// The skeleton. The pelvis height is derived, never set: the hips sit just
// low enough, and far enough back, that the helmet tops out on the hitbox,
// centred over the feet, whatever the lean. Standing that puts the hips at
// 0.80 m and the shoulders at 1.33 m; crouched, the hips at 0.28 m.
const WAIST = 0.02; // pelvis pivot → chest bone
const NECK = 0.6; // chest bone → head base
const HEAD_H = 0.38; // head base → helmet top
const SHOULDER = [0.25, 0.51]; // [x, y] of the shoulder joints on the chest; the aim pivot is between them
const HIP = 0.1; // x of the hip joints on the pelvis
const ARM = [0.3, 0.29]; // upper arm, forearm to the grip
const LEG = [0.42, 0.36]; // thigh, shin
const ANKLE = 0.04; // ankle above the sole (standing, the knees flex a little)
const FOOT_X = 0.1; // each foot's x, standing
const CROUCH_FEET = [[-0.13, 0.05, -0.1], [0.13, 0.09, 0.12]]; // each ankle crouched: left foot planted (1 cm up, so the shin clears the floor), right knee down on its toes
const KNEE_POLE = [0, 0, -1]; // knees bend toward this standing…
const KNEE_POLE_CROUCH = [[0.3, 0, -1], [0, 0.15, -1]]; // …and these crouched (left, right; the left knee turned in a little stays on the hitbox)
const ELBOW_POLE = [0.6, -1, 0.3]; // the right elbow bends toward this; the left mirrors it
const AIR_GAP = 0.06; // soles this far above the ground count as airborne
const SMOOTH_VELOCITY = 0.08; // s to ~63% of a change
const SMOOTH_AIR = 0.05;

// ?debug&lineup[=shade|fx] replaces the players with the 10 slot rigs in a
// row 0.9 m apart, all dropping 30 HP at each whole second (3 seconds in 4)
// to show the hit flash (not in fx). sun: z 3, x −4.05…4.05, facing +z. shade: x 8.9,
// z 4…12.1, facing +x. The bible's x 9.6, z 5…13.1 is in shade under the bible's
// sun, but its heads are lit under main's 50° sun; x 8.9 is shaded under both.
// fx: the sun row with Shield (Red, Blue, Cyan, Pink), slowed (Green, Orange,
// Magenta) and Nitro (Yellow, Purple, Lime, circling 2 m in front of the row).
// &still holds hp (no flash) for clean stills; &turn=deg turns every rig (fit
// checks at 45°); &crouch crouches them.
// Cameras (?debug&lineup&cam=x,y,z,yaw,pitch), each with a clear line to the
// helmet and torso of all 10 rigs on arena_01 (the far ones look over a wall):
//   sun   10 m: -2,1.6,12.8,-0.201,-0.06   25 m: -9.5,5.1,26.12,-0.39,-0.163   35 m: -15,7.6,34.62,-0.443,-0.186
//   shade 10 m: 18.9,1.6,8.05,1.5708,-0.03   25 m: 33.9,11,8.05,1.5708,-0.4   35 m: 43.9,15,8.05,1.5708,-0.4
const params = new URLSearchParams(globalThis.location?.search ?? '');
const LINEUP = params.has('debug') && params.has('lineup') ? params.get('lineup') || 'sun' : null;
const STILL = params.has('still');
const CROUCH = params.has('crouch');
const TURN = (+params.get('turn') || 0) * D;

// ─── Engine ─────────────────────────────────────────────────────────────────

export const charactersGroup = new THREE.Group();

const BONES = ['pelvis', 'chest', 'head', 'gun', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const B = Object.fromEntries(BONES.map((name, i) => [name, i]));
const bones = BONES.map(() => new THREE.Matrix4()); // the rig being posed, rig space then world

const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const parts = PARTS.map((p, i) => ({
  ...p,
  bone: B[p.bone],
  offset: new THREE.Matrix4().makeTranslation(...p.at),
  scale: new THREE.Vector3(...p.size),
  // Where this part flies in from when the player spawns.
  from: new THREE.Vector3(hash(3 * i) - 0.5, hash(3 * i + 1) - 0.5, hash(3 * i + 2) - 0.5).multiplyScalar(2 * LOOK.spawn.spread),
}));
const lit = parts.filter((p) => !p.unlit);
const perRig = (keep) => parts.filter((p) => keep(p) && !p.weapon).length
  + Math.max(...Object.keys(GUNS).map((w) => parts.filter((p) => keep(p) && p.weapon === w).length));
const LIT_PER_RIG = perRig((p) => !p.unlit); // 26
const HULL_PER_RIG = perRig((p) => p.outline); // 16
const UNLIT_PER_RIG = perRig((p) => p.unlit) + LOOK.sparks.count; // visor + sparks
const RIGS = MAX_PLAYERS;
const SPARK_PARTS = ['torso', 'pack', 'helmet', 'thighL', 'thighR', 'shinL', 'shinR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR'].map((n) => parts.findIndex((p) => p.name === n));

const cube = new THREE.BoxGeometry(1, 1, 1);
const bodyMaterial = new THREE.MeshLambertMaterial({ fog: false });
// The character lift (a share of the albedo is self-lit, so slot hues read in
// shade) and the bevels. The unit cube's local position and the instance's
// scale give each fragment its distance in metres to the nearest box edge.
const glsl = (n) => n.toFixed(4);
bodyMaterial.onBeforeCompile = (shader) => {
  const { bevel } = LOOK;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBox;\nvarying vec3 vSize;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vBox = position;
      vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBox;\nvarying vec3 vSize;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 q = (0.5 - abs(vBox)) * vSize; // to each pair of faces; the smallest is this face's own
      float edge = q.x + q.y + q.z - min(q.x, min(q.y, q.z)) - max(q.x, max(q.y, q.z));
      float bevel = (1.0 - smoothstep(${glsl(bevel.width[0])}, ${glsl(bevel.width[1])}, edge))
        * (1.0 - smoothstep(${glsl(bevel.fade[0])}, ${glsl(bevel.fade[1])}, -vViewPosition.z));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${glsl(bevel.gain)} + ${glsl(bevel.add)}, bevel);
      totalEmissiveRadiance += diffuseColor.rgb * ${glsl(LOOK.lift)};`);
};
bodyMaterial.customProgramCacheKey = () => 'boxfire-character-lift';
const body = new THREE.InstancedMesh(cube, bodyMaterial, RIGS * LIT_PER_RIG);
const hull = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false }), RIGS * HULL_PER_RIG);
const unlit = new THREE.InstancedMesh(cube, new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }), RIGS * UNLIT_PER_RIG);
// Blob shadows darken what is under them: dst × (1 − colour × alpha), so each
// instance's colour is its darkness (in display terms) and overlaps need no sorting.
const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
  map: blobTexture(), transparent: true, depthWrite: false, blending: THREE.SubtractiveBlending, premultipliedAlpha: true,
  toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
}), RIGS);
// Shield bubbles: a fresnel shell, faint in the middle and bright at the rim.
const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 13), new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(LOOK.bubble.color) }, alpha: { value: new THREE.Vector2(...LOOK.bubble.alpha) } },
  vertexShader: `varying float vRim;
    void main() {
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      vRim = 1.0 - abs(dot(n, normalize(cameraPosition - world.xyz)));
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: `uniform vec3 color; uniform vec2 alpha; varying float vRim;
    void main() {
      gl_FragColor = vec4(color, mix(alpha.x, alpha.y, vRim * vRim));
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false,
}), RIGS);

// Nitro ribbons: one camera-facing strip behind each boot, rebuilt each frame
// from the last LOOK.ribbon.ms of boot positions. Slot colour fading out,
// with a dark fringe so they read in daylight.
const HISTORY = Math.ceil(LOOK.ribbon.ms / LOOK.ribbon.sampleMs) + 1; // samples kept per boot
const POINTS = HISTORY + 1; // plus the boot where it is now
const RIBBONS = 2 * RIGS;
const ribbonGeometry = new THREE.BufferGeometry();
const ribbonPos = new Float32Array(RIBBONS * POINTS * 2 * 3);
const ribbonColor = new Float32Array(RIBBONS * POINTS * 2 * 3);
const ribbonUv = new Float32Array(RIBBONS * POINTS * 2 * 2); // x: −1 / +1 across, y: age 0…1
ribbonGeometry.setAttribute('position', new THREE.BufferAttribute(ribbonPos, 3).setUsage(THREE.DynamicDrawUsage));
ribbonGeometry.setAttribute('color', new THREE.BufferAttribute(ribbonColor, 3).setUsage(THREE.DynamicDrawUsage));
ribbonGeometry.setAttribute('uv', new THREE.BufferAttribute(ribbonUv, 2).setUsage(THREE.DynamicDrawUsage));
const ribbonIndex = [];
for (let r = 0; r < RIBBONS; r++) {
  for (let k = 0; k < POINTS - 1; k++) {
    const a = (r * POINTS + k) * 2;
    ribbonIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}
ribbonGeometry.setIndex(ribbonIndex);
const ribbons = new THREE.Mesh(ribbonGeometry, new THREE.ShaderMaterial({
  uniforms: { fringe: { value: new THREE.Color(LOOK.ribbon.fringe) }, alpha: { value: new THREE.Vector2(LOOK.ribbon.alpha, LOOK.ribbon.fringeAlpha) } },
  vertexShader: `attribute vec3 color; varying vec3 vColor; varying vec2 vUv;
    void main() { vColor = color; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 fringe; uniform vec2 alpha; varying vec3 vColor; varying vec2 vUv;
    void main() {
      float edge = smoothstep(0.62, 0.78, abs(vUv.x));
      float fade = clamp((1.0 - vUv.y) / ${glsl(1 - LOOK.ribbon.hold)}, 0.0, 1.0);
      gl_FragColor = vec4(mix(vColor, fringe, edge), mix(alpha.x, alpha.y, edge) * fade);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
}));

const INSTANCED = [body, hull, unlit, blobs, bubbles];
for (const mesh of INSTANCED) {
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (mesh !== bubbles) {
    mesh.setColorAt(0, new THREE.Color()); // instanceColor exists from the start, so the shader never recompiles for it
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.count = 0; // visible but empty until the first frame, so the lobby's shader compile covers it
}
for (const mesh of [...INSTANCED, ribbons]) {
  mesh.frustumCulled = false; // bounds are not tracked as players move
  mesh.castShadow = false;
}
ribbonGeometry.setDrawRange(0, 0);
// Blended order, against effects' decals (−1), dust (0), tracers (1) and sparks: the blobs
// darken the ground and decals but no particle; ribbons and bubbles stay under tracers.
blobs.renderOrder = -0.5;
ribbons.renderOrder = 0.5;
bubbles.renderOrder = 0.6;
body.receiveShadow = true; // world shadows fall on players; players never cast into the (static) shadow map
charactersGroup.add(body, hull, unlit, blobs, bubbles, ribbons);

const paints = Object.fromEntries(Object.entries(LOOK.paints).map(([k, hex]) => [k, new THREE.Color(hex)]));
const WHITE = new THREE.Color(1, 1, 1);
const OUTLINE = new THREE.Color(LOOK.outline.color);
const SPARK = new THREE.Color(LOOK.sparks.color);

const rigs = new Map(); // player id → rig
let frame = 0; // syncPlayers calls so far; a rig drawn in the latest has seen === frame
let mapBoxes = null; // prepared map boxes: the ground under players, sun and tag sight lines
let sunDir = null;
let mainCamera = null; // initCharacters' camera
let sunFallback = false; // no shadow map: dim players by rays to the sun instead
let low = false; // the Low preset never has a shadow map
let shadowsOn = true;
let nb = 0; // instances written this frame: body, hull, unlit, blobs, bubbles, ribbons
let nh = 0;
let nu = 0;
let nblob = 0;
let nbubble = 0;
let nribbon = 0;

// Scratch objects, so the per-frame path never allocates.
const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _air = new THREE.Vector3();
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
const _cam = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _edge = new THREE.Color();
const _o = [0, 0, 0];
const _dir = [0, 0, 0];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const drawn = (rig, now) => rig.seen === frame && now >= rig.hiddenUntil;

// boxes: prepareMap(map).boxes. sunDir: unit vector toward the sun.
// quality 'low' has no shadow map, so players use the sun-ray fallback.
// camera: used when syncPlayers is not given one.
export function initCharacters({ boxes = null, sunDir: dir = null, quality = 'default', camera = null } = {}) {
  mapBoxes = boxes;
  sunDir = dir;
  mainCamera = camera;
  low = quality === 'low';
  setShadows(shadowsOn);
}

// Shadows on: players receive the static sun shadow map per pixel. Off: three
// rays toward the sun, eased, dim them in shade.
export function setShadows(on) {
  shadowsOn = !!on;
  body.receiveShadow = shadowsOn && !low;
  sunFallback = !body.receiveShadow;
}

// Once per frame. list: [{ id, x, y, z, yaw, pitch, crouch, shielded, hp,
// weapon, bubble?, nitro?, slowed? }] of the players to draw; roster: id →
// { name, slot }; dt: seconds since the last frame; camera: for the outline
// width and the ribbons (default: initCharacters' camera). A 4th argument
// that is a box list (as main.js passes today) stands in for initCharacters' boxes.
export function syncPlayers(list, roster, dt, camera = null, more = null) {
  const now = performance.now();
  const boxes = Array.isArray(camera) ? camera : mapBoxes;
  if (!camera?.isCamera) camera = more?.isCamera ? more : mainCamera;
  if (LINEUP) ({ list, roster } = lineup(now));
  if (camera) camera.getWorldPosition(_cam);
  frame++;
  nb = nh = nu = nblob = nbubble = nribbon = 0;
  for (const p of list) {
    const info = roster.get(p.id);
    if (!info) continue;
    let rig = rigs.get(p.id);
    if (!rig) rigs.set(p.id, (rig = makeRig(p.id)));
    rig.name = info.name;
    if (rig.slot !== info.slot) dress(rig, info.slot);
    if (now < rig.hiddenUntil || nb + LIT_PER_RIG > body.instanceMatrix.count) continue;
    const fresh = rig.seen !== frame - 1;
    animate(rig, p, dt, fresh, boxes, now);
    rig.seen = frame;
    rig.p = p;
    pose(rig, p, now);
    drawRig(rig, p, now, camera);
    drawBlob(rig, p);
    if (p.bubble) drawBubble(rig, p);
    drawRibbons(rig, p, now, camera);
  }
  for (const id of rigs.keys()) if (!roster.has(id)) rigs.delete(id);
  finish(body, nb);
  finish(hull, nh);
  finish(unlit, nu);
  finish(blobs, nblob);
  finish(bubbles, nbubble);
  ribbonGeometry.setDrawRange(0, nribbon * (POINTS - 1) * 6);
  ribbons.visible = nribbon > 0;
  if (nribbon) for (const name of ['position', 'color', 'uv']) ribbonGeometry.attributes[name].needsUpdate = true;
}

function finish(mesh, n) {
  mesh.count = n;
  mesh.visible = n > 0; // an empty mesh still costs its state changes
  if (!n) return;
  mesh.instanceMatrix.needsUpdate = true; // whole buffers (≤ 17 KB): an update range would allocate each frame
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// A hit landed on this player: flash them. (Drops in hp flash them too.)
export function hitFlash(id) {
  const rig = rigs.get(id);
  if (rig) rig.flashAt = performance.now();
}

// This player fired: kick their gun back and up.
export function fired(id) {
  const rig = rigs.get(id);
  if (rig) rig.kickAt = performance.now();
}

// World position of this player's drawn muzzle, or null when not on screen.
export function muzzleOf(id) {
  const rig = rigs.get(id);
  const now = performance.now();
  if (!rig || !drawn(rig, now)) return null;
  pose(rig, rig.p, now);
  return _v.fromArray(GUNS[rig.weapon].muzzle).applyMatrix4(bones[B.gun]).toArray();
}

// fired() plus muzzleOf() into `muzzle` (a THREE.Vector3); false when the
// player is not on screen (muzzle left untouched).
export function fireKick(id, muzzle) {
  const at = muzzleOf(id);
  fired(id);
  if (at && muzzle) muzzle.fromArray(at);
  return !!at;
}

// Screen positions for the DOM name tags (hud draws them): players within
// LOOK.tags.range m, or within LOOK.tags.cone of the crosshair, whose head the
// camera can see. alpha eases over LOOK.tags.fadeMs. The array and its
// entries are reused from call to call.
const tags = [];
const tagPool = [];
let tagsAt = 0;
export function nameTags(camera, width, height) {
  const now = performance.now();
  const step = Math.min(1, (now - tagsAt) / LOOK.tags.fadeMs);
  tagsAt = now;
  tags.length = 0;
  camera.getWorldPosition(_cam);
  camera.getWorldDirection(_fwd);
  const cosCone = Math.cos(LOOK.tags.cone);
  for (const rig of rigs.values()) {
    let want = 0;
    if (drawn(rig, now)) {
      const p = rig.p;
      _v.set(p.x, p.y + lerp(STAND_HEIGHT, CROUCH_HEIGHT, rig.c) - 0.15, p.z); // the head's centre
      _d.subVectors(_v, _cam);
      const dist = _d.length();
      if (dist > 0.01 && (dist <= LOOK.tags.range || _d.dot(_fwd) / dist >= cosCone) && clearLine(_cam, _d, dist)) want = 1;
    }
    rig.tagAlpha = want ? Math.min(1, rig.tagAlpha + step) : Math.max(0, rig.tagAlpha - step);
    if (rig.tagAlpha <= 0 || !rig.p) continue;
    _v.set(rig.p.x, rig.p.y + lerp(STAND_HEIGHT, CROUCH_HEIGHT, rig.c) + LOOK.tags.lift, rig.p.z);
    if (_d.subVectors(_v, _cam).dot(_fwd) <= 0) continue; // behind the camera
    _v.project(camera);
    const tag = tagPool[tags.length] ?? (tagPool[tags.length] = { id: 0, name: '', color: '', x: 0, y: 0, alpha: 0 });
    tag.id = rig.id;
    tag.name = rig.name;
    tag.color = rig.hex;
    tag.x = ((_v.x + 1) / 2) * width;
    tag.y = ((1 - _v.y) / 2) * height;
    tag.alpha = rig.tagAlpha;
    tags.push(tag);
  }
  return tags;
}

// Is the segment from `from` along `dir` (length `dist`, not unit) clear of map boxes?
function clearLine(from, dir, dist) {
  if (!mapBoxes) return true;
  _o[0] = from.x;
  _o[1] = from.y;
  _o[2] = from.z;
  _dir[0] = dir.x / dist;
  _dir[1] = dir.y / dist;
  _dir[2] = dir.z / dist;
  for (const b of mapBoxes) if (rayBox(_o, _dir, b.min, b.max) < dist - 0.05) return false;
  return true;
}

// This player died: hide them now (for at least LOOK.shatter.hideMs) and
// return their body as world-space boxes for effects to explode, each part
// split into voxels at most `voxel` a side (Infinity: one box per part). Each
// is { part, position, quaternion, scale, color, velocity }: the part's name,
// the box centre, its rotation, its size in metres on its own axes, its
// linear colour and the player's velocity in m/s, all fresh THREE objects.
// Empty when the player is not on screen.
export function shatter(id, voxel = LOOK.shatter.voxel) {
  const rig = rigs.get(id);
  const now = performance.now();
  if (!rig || !drawn(rig, now)) return [];
  pose(rig, rig.p, now);
  rig.hiddenUntil = now + LOOK.shatter.hideMs;
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

function makeRig(id) {
  return {
    id, name: '', slot: null, hex: '', colors: parts.map(() => new THREE.Color()),
    p: null, weapon: 'rifle', seen: -1, hiddenUntil: 0, flashAt: -Infinity, kickAt: -Infinity, spawnAt: -Infinity, hp: 0,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ground: 0, sun: 1, tagAlpha: 0,
    crouchT: 0, c: 0, air: 0, run: 0, forward: 0, dirX: 0, dirZ: -1, phase: 0,
    trail: null, trailHead: 0, trailAt: -Infinity, // Nitro: boot history, [x, y, z, ms] × HISTORY per boot
  };
}

// Colours for whoever the rig is now; redone only on a change.
function dress(rig, slot) {
  rig.hex = PLAYER_COLORS[slot] ?? '#808080';
  const own = new THREE.Color(rig.hex);
  parts.forEach((part, i) => {
    if (part.paint === 'slot') rig.colors[i].copy(own);
    else if (part.paint === 'visor') rig.colors[i].copy(own).multiplyScalar(1 / Math.max(own.r, own.g, own.b, 1e-3)); // full value
    else rig.colors[i].copy(paints[part.paint]);
  });
  rig.slot = slot;
}

// Advance a rig's smoothed state to this frame. `fresh`: it was not drawn
// last frame (just joined, respawned or un-hidden), so snap rather than blend,
// and assemble the body.
function animate(rig, p, dt, fresh, boxes, now) {
  rig.weapon = GUNS[p.weapon] ? p.weapon : 'rifle';
  rig.ground = groundBelow(p, boxes);
  const air = p.y - rig.ground > AIR_GAP ? 1 : 0;
  const h = clamp(dt, 0, 0.1);
  if (fresh) {
    rig.vx = rig.vy = rig.vz = 0;
    rig.crouchT = p.crouch ? 1 : 0;
    rig.air = air;
    rig.spawnAt = now;
    rig.flashAt = -Infinity;
    rig.trailAt = -Infinity;
  } else if (dt > 0) {
    const k = 1 - Math.exp(-h / SMOOTH_VELOCITY);
    rig.vx += ((p.x - rig.x) / dt - rig.vx) * k;
    rig.vy += ((p.y - rig.y) / dt - rig.vy) * k;
    rig.vz += ((p.z - rig.z) / dt - rig.vz) * k;
    rig.crouchT = clamp(rig.crouchT + (p.crouch ? 1 : -1) * ((h * 1000) / LOOK.crouchMs), 0, 1);
    rig.air += (air - rig.air) * (1 - Math.exp(-h / SMOOTH_AIR));
    if (p.hp < rig.hp && now - rig.flashAt > LOOK.flash.hold + LOOK.flash.fade) rig.flashAt = now;
  }
  rig.hp = p.hp ?? 100;
  rig.c = rig.crouchT * rig.crouchT * (3 - 2 * rig.crouchT); // eased
  rig.x = p.x;
  rig.y = p.y;
  rig.z = p.z;
  // Ground speed in the rig's own frame drives the stride: π of phase per step.
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
  rig.forward = clamp(-lz / RUN_SPEED, -1, 1);
  rig.phase = (rig.phase + (Math.PI * speed * h * (1 - rig.air)) / LOOK.step) % (2 * Math.PI);
  // Shadows off: the share of three points on the body the sun reaches, eased.
  if (sunFallback && sunDir && boxes) {
    let seen = 0;
    for (const y of LOOK.sunFallback.heights) seen += sunSees(p.x, p.y + y, p.z, boxes);
    const target = seen / LOOK.sunFallback.heights.length;
    rig.sun = fresh ? target : lerp(target, rig.sun, 2 ** ((-h * 1000) / LOOK.sunFallback.halflife));
  } else rig.sun = 1;
}

function sunSees(x, y, z, boxes) {
  _o[0] = x;
  _o[1] = y;
  _o[2] = z;
  for (const b of boxes) if (rayBox(_o, sunDir, b.min, b.max) < Infinity) return 0;
  return 1;
}

// Pose the skeleton into `bones`, in world space.
function pose(rig, p, now) {
  const gun = GUNS[rig.weapon];
  const move = rig.run * (1 - rig.air);
  const spine = WAIST + NECK;
  const lean = LOOK.leanCrouch * rig.c + LOOK.leanRun * rig.forward * (1 - rig.air) - LOOK.torsoPitch * p.pitch;
  const top = lerp(STAND_HEIGHT, CROUCH_HEIGHT, rig.c);
  bones[B.pelvis].makeRotationX(-lean)
    .setPosition(0, top - HEAD_H - spine * Math.cos(lean) + LOOK.bob * move * Math.cos(2 * rig.phase), spine * Math.sin(lean) - LOOK.crouchShift * rig.c);
  // Chest: up the waist, turned into the weapon's stance and against the stride.
  _m.makeRotationY(gun.twist + LOOK.twist * move * Math.sin(rig.phase)).setPosition(0, WAIST, 0);
  bones[B.chest].multiplyMatrices(bones[B.pelvis], _m);
  // Head: level on the neck, taking the full aim pitch about its own centre,
  // so it stays in its hitbox (which never rotates).
  _v.set(0, NECK, 0).applyMatrix4(bones[B.chest]);
  bones[B.head].makeRotationX(clamp(p.pitch, -LOOK.headPitch, LOOK.headPitch))
    .setPosition(_v.x, _v.y + HEAD_H / 2, _v.z)
    .multiply(_m.makeTranslation(0, -HEAD_H / 2, 0));
  // Gun: pivots between the shoulders with the full aim pitch, kicks back and
  // up after a shot and rolls with the stride.
  const t = (now - rig.kickAt) / LOOK.kick.ms;
  const kick = t >= 0 && t < 1 ? (1 - t) ** 2 : 0;
  _v.set(0, SHOULDER[1], 0).applyMatrix4(bones[B.chest]);
  bones[B.gun].makeRotationX(p.pitch).setPosition(_v);
  _m.makeRotationFromEuler(_e.set(LOOK.kick.pitch * kick, 0, LOOK.sway * move * Math.sin(rig.phase)))
    .setPosition(gun.hold[0], gun.hold[1], gun.hold[2] + LOOK.kick.back * kick);
  bones[B.gun].multiply(_m);
  arm(-1, gun.left, B.upperArmL);
  arm(1, gun.right, B.upperArmR);
  leg(rig, 0, B.thighL);
  leg(rig, 1, B.thighR);
  // Into the world: a hit flinches the rig back and swells it for a moment.
  const tf = now - rig.flashAt;
  const hit = tf < LOOK.flash.hold ? 1 : tf < LOOK.flash.hold + LOOK.flash.fade ? 1 - (tf - LOOK.flash.hold) / LOOK.flash.fade : 0;
  const back = LOOK.flash.flinch * hit;
  _world.makeRotationY(p.yaw).setPosition(p.x + Math.sin(p.yaw) * back, p.y, p.z + Math.cos(p.yaw) * back);
  if (tf < LOOK.flash.hold) {
    const k = LOOK.flash.scale;
    _world.multiply(_m.makeTranslation(0, 0.9, 0)).multiply(_s.makeScale(k, k, k)).multiply(_m.makeTranslation(0, -0.9, 0));
  }
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

// A leg: running, the thigh swings along the direction of travel and the
// knee folds on the back-swing, the foot never below the ground; crouched,
// the feet plant in a kneeling stance; in the air, thigh and knee bend
// forward. Two-bone IK then fits the leg to that foot.
function leg(rig, s, i) {
  const side = s ? 1 : -1;
  const c = rig.c;
  const ph = rig.phase + s * Math.PI;
  const amp = rig.run * (1 - rig.air);
  _a.set(side * HIP, 0, 0).applyMatrix4(bones[B.pelvis]); // hip joint
  const swing = amp * lerp(LOOK.thighSide, LOOK.thigh, Math.abs(rig.dirZ)) * Math.sin(ph);
  const fold = amp * LOOK.knee * Math.max(0, Math.cos(ph + Math.PI / 4));
  footFrom(_a, side * (FOOT_X - HIP), rig.dirX, rig.dirZ, swing, fold, _t);
  _t.y = Math.max(_t.y, ANKLE);
  // Crouched: the planted stance, shuffling along the direction of travel.
  const shuffle = 0.25 * amp * Math.sin(ph);
  _q.set(CROUCH_FEET[s][0] + rig.dirX * shuffle, CROUCH_FEET[s][1], CROUCH_FEET[s][2] + rig.dirZ * shuffle);
  _t.lerp(_q, c);
  footFrom(_a, side * (FOOT_X - HIP), 0, -1, LOOK.airThigh, LOOK.airKnee, _air);
  _t.lerp(_air, rig.air);
  _pole.fromArray(KNEE_POLE).lerp(_q.fromArray(KNEE_POLE_CROUCH[s]), c);
  limb(_a, _t, LEG[0], LEG[1], _pole, bones[i], bones[i + 1], _end);
  bones[i + 2].makeTranslation(_end.x, _end.y, _end.z); // boots stay level
}

// Ankle position for a thigh angle and a knee fold, swinging along (dx, dz).
function footFrom(hip, x, dx, dz, thigh, fold, out) {
  const along = LEG[0] * Math.sin(thigh) + LEG[1] * Math.sin(thigh - fold);
  return out.set(hip.x + x + dx * along, hip.y - LEG[0] * Math.cos(thigh) - LEG[1] * Math.cos(thigh - fold), hip.z + dz * along);
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

// Body, hull and unlit instances for one rig, with the hit flash, the spawn
// assembly and the spawn-protection pulse.
function drawRig(rig, p, now, camera) {
  const tf = now - rig.flashAt;
  const flash = tf < LOOK.flash.hold ? 1 : tf < LOOK.flash.hold + LOOK.flash.fade ? 1 - (tf - LOOK.flash.hold) / LOOK.flash.fade : 0;
  const pulse = p.shielded ? 0.5 + 0.5 * Math.sin((now * LOOK.protect.hz * 2 * Math.PI) / 1000) : 0;
  const white = Math.max(LOOK.flash.white * flash, LOOK.protect.white * pulse);
  const edge = Math.max(flash, pulse);
  const u = Math.min(1, (now - rig.spawnAt) / LOOK.spawn.ms);
  const built = 1 - (1 - u) ** 3; // ease-out
  const dist = camera ? _cam.distanceTo(_v.set(p.x, p.y + 1, p.z)) : 0;
  const grow = 2 * Math.max(LOOK.outline.min, LOOK.outline.perMetre * dist);
  const shade = LOOK.sunFallback.min + (1 - LOOK.sunFallback.min) * rig.sun;
  const outline = _edge.copy(OUTLINE).lerp(WHITE, edge);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.weapon && part.weapon !== rig.weapon) continue;
    _m.multiplyMatrices(bones[part.bone], part.offset);
    if (built < 1) {
      _m.elements[12] += part.from.x * (1 - built);
      _m.elements[13] += part.from.y * (1 - built);
      _m.elements[14] += part.from.z * (1 - built);
    }
    _s.copy(_m).scale(_scale.copy(part.scale).multiplyScalar(built));
    if (part.unlit) {
      unlit.setMatrixAt(nu, _s);
      unlit.setColorAt(nu++, _c.copy(rig.colors[i]).lerp(WHITE, white));
      continue;
    }
    body.setMatrixAt(nb, _s);
    body.setColorAt(nb++, _c.copy(rig.colors[i]).multiplyScalar(shade).lerp(WHITE, white));
    if (part.outline) {
      hull.setMatrixAt(nh, _s.copy(_m).scale(_scale.copy(part.scale).addScalar(grow).multiplyScalar(built)));
      hull.setColorAt(nh++, outline);
    }
  }
  if (p.slowed) drawSparks(rig, now);
}

// Slowed: sparks crawl up the body's big parts, hopping to another part LOOK.sparks.hops times a second.
function drawSparks(rig, now) {
  const { count, size, hops } = LOOK.sparks;
  for (let j = 0; j < count; j++) {
    const t = (now / 1000) * hops + j / count;
    const n = Math.floor(t);
    const along = t - n;
    const part = parts[SPARK_PARTS[Math.floor(hash(n * 7 + j * 13) * SPARK_PARTS.length)]];
    const face = hash(n * 3 + j * 5);
    _v.set(face < 0.5 ? (face < 0.25 ? -0.5 : 0.5) : hash(n + j) - 0.5, along - 0.5, face >= 0.5 ? (face < 0.75 ? -0.5 : 0.5) : hash(n - j) - 0.5)
      .multiply(part.scale)
      .applyMatrix4(_m.multiplyMatrices(bones[part.bone], part.offset));
    unlit.setMatrixAt(nu, _s.makeScale(size, size, size).setPosition(_v));
    unlit.setColorAt(nu++, SPARK);
  }
}

function drawBlob(rig, p) {
  const height = p.y - rig.ground;
  if (!(height >= -0.05)) return; // nothing below
  const k = 1 / (1 + Math.max(0, height));
  const size = 2 * LOOK.blob.radius * k;
  blobs.setMatrixAt(nblob, _s.makeScale(size, 1, size).setPosition(p.x, rig.ground + LOOK.blob.lift, p.z));
  const dark = LOOK.blob.darkness * k;
  blobs.setColorAt(nblob++, _c.setRGB(dark, dark, dark, THREE.SRGBColorSpace)); // the output encoding brings it back to `dark`
}

function drawBubble(rig, p) {
  const r = LOOK.bubble.radius;
  bubbles.setMatrixAt(nbubble++, _s.makeScale(r, r, r).setPosition(p.x, p.y + lerp(LOOK.bubble.y, LOOK.bubble.yCrouch, rig.c), p.z));
}

// Nitro: record the path under each boot (the hip line, so the stride's
// swing doesn't zig-zag it) and draw a ribbon along each.
const bootX = (p, s) => p.x + (s ? 1 : -1) * LOOK.ribbon.apart * Math.cos(p.yaw);
const bootZ = (p, s) => p.z - (s ? 1 : -1) * LOOK.ribbon.apart * Math.sin(p.yaw);
function drawRibbons(rig, p, now, camera) {
  const { ms, sampleMs, width, height } = LOOK.ribbon;
  if (p.nitro && now - rig.trailAt >= sampleMs) {
    rig.trail ??= [new Float32Array(HISTORY * 4), new Float32Array(HISTORY * 4)];
    rig.trailHead = (rig.trailHead + 1) % HISTORY;
    rig.trailAt = now;
    for (let s = 0; s < 2; s++) {
      const at = rig.trailHead * 4;
      rig.trail[s][at] = bootX(p, s);
      rig.trail[s][at + 1] = rig.ground > -Infinity ? rig.ground + height : p.y + height;
      rig.trail[s][at + 2] = bootZ(p, s);
      rig.trail[s][at + 3] = now;
    }
  }
  if (!rig.trail || !camera || now - rig.trailAt > ms) return;
  for (let s = 0; s < 2; s++) {
    const trail = rig.trail[s];
    const base = nribbon * POINTS;
    let n = 0;
    if (p.nitro) n = ribbonPoint(base, n, bootX(p, s), (rig.ground > -Infinity ? rig.ground : p.y) + height, bootZ(p, s), 0, rig.colors[1]);
    for (let k = 0; k < HISTORY; k++) {
      const at = ((rig.trailHead - k + HISTORY) % HISTORY) * 4;
      const age = (now - trail[at + 3]) / ms;
      if (!(age < 1)) break;
      n = ribbonPoint(base, n, trail[at], trail[at + 1], trail[at + 2], age, rig.colors[1]);
    }
    if (n < 2) continue;
    for (let k = n; k < POINTS; k++) copyPoint(base + n - 1, base + k); // unused points collapse onto the last
    _pole.set(0, 0, 0); // the previous point's side, so the strip never twists where the path doubles back
    for (let k = 0; k < n; k++) sidePoint(base, k, n, width / 2);
    nribbon++;
  }
}

// Writes point k of a ribbon (centre in both of its vertices for now).
function ribbonPoint(base, k, x, y, z, age, color) {
  const v = (base + k) * 2;
  for (let e = 0; e < 2; e++) {
    ribbonPos[(v + e) * 3] = x;
    ribbonPos[(v + e) * 3 + 1] = y;
    ribbonPos[(v + e) * 3 + 2] = z;
    ribbonColor[(v + e) * 3] = color.r;
    ribbonColor[(v + e) * 3 + 1] = color.g;
    ribbonColor[(v + e) * 3 + 2] = color.b;
    ribbonUv[(v + e) * 2] = e ? 1 : -1;
    ribbonUv[(v + e) * 2 + 1] = age;
  }
  return k + 1;
}

function copyPoint(from, to) {
  ribbonPos.copyWithin(to * 6, from * 6, from * 6 + 6);
  ribbonColor.copyWithin(to * 6, from * 6, from * 6 + 6);
  ribbonUv.copyWithin(to * 4, from * 4, from * 4 + 4);
}

// Spread point k's two vertices across the ribbon, facing the camera.
// (Points are read as their vertices' midpoint, so spread neighbours still read true.)
const mid = (i, a) => (ribbonPos[i + a] + ribbonPos[i + a + 3]) / 2;
function sidePoint(base, k, n, half) {
  const v = (base + k) * 6;
  const a = (base + Math.max(0, k - 1)) * 6;
  const b = (base + Math.min(n - 1, k + 1)) * 6;
  _t.set(mid(b, 0) - mid(a, 0), mid(b, 1) - mid(a, 1), mid(b, 2) - mid(a, 2));
  _v.set(ribbonPos[v], ribbonPos[v + 1], ribbonPos[v + 2]);
  _d.subVectors(_cam, _v);
  _x.crossVectors(_t, _d);
  if (_x.lengthSq() < 1e-10) _x.set(0, 1, 0);
  _x.normalize().multiplyScalar(half);
  if (_x.dot(_pole) < 0) _x.negate();
  _pole.copy(_x);
  ribbonPos[v] -= _x.x;
  ribbonPos[v + 1] -= _x.y;
  ribbonPos[v + 2] -= _x.z;
  ribbonPos[v + 3] += _x.x;
  ribbonPos[v + 4] += _x.y;
  ribbonPos[v + 5] += _x.z;
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
      const a = Math.min(1, Math.max(0, 1 - Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)) / (1 - LOOK.blob.core)); // (runs before clamp exists)
      data[(y * n + x) * 4 + 3] = 255 * a * a * (3 - 2 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ?debug&lineup: the 10 slot rigs, built once and updated in place.
const NAMES = ['Red', 'Green', 'Yellow', 'Blue', 'Orange', 'Purple', 'Cyan', 'Magenta', 'Lime', 'Pink'];
let fakes = null;
function lineup(now) {
  if (!fakes) {
    const shade = LINEUP === 'shade';
    const list = NAMES.map((name, i) => ({
      id: 1001 + i, x: shade ? 8.9 : -4.05 + 0.9 * i, y: 0, z: shade ? 4 + 0.9 * i : 3, yaw: (shade ? -Math.PI / 2 : Math.PI) + TURN, pitch: 0,
      crouch: CROUCH, alive: true, shielded: false, hp: 100, weapon: ['rifle', 'pistol', 'shotgun'][i % 3],
      bubble: false, nitro: false, slowed: false,
    }));
    fakes = { list, roster: new Map(list.map((p, i) => [p.id, { name: NAMES[i], slot: i }])), x: list.map((p) => p.x) };
  }
  const t = now / 1000;
  fakes.list.forEach((p, i) => {
    if (LINEUP !== 'fx') {
      if (!STILL) p.hp = 100 - 30 * (Math.floor(t) % 4);
      return;
    }
    p.bubble = i % 3 === 0;
    p.slowed = i % 3 === 1;
    p.nitro = i % 3 === 2;
    if (p.nitro) { // circling 1 m round a point 2 m in front of the row, at 5 m/s
      p.x = fakes.x[i] + Math.cos(5 * t);
      p.z = 5 + Math.sin(5 * t);
      p.yaw = Math.PI - 5 * t;
    }
  });
  return fakes;
}
