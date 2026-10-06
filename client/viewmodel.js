// First-person arms and gun. Each weapon is a couple of dozen boxes from the
// data below, merged into three vertex-coloured meshes: the gun with the
// right arm, the animated part (magazine or pump) and the left arm. Springs
// move it with the mouse, strafing, footsteps, landings and recoil; reload
// and switch poses follow the arsenal's own timers, so prediction, cancels
// and corrections need nothing extra. It has its own scene and camera, drawn
// after the world with the depth buffer cleared, so it never clips into a
// wall and keeps its shape whatever FOV the player picks. Only the viewmodel
// moves: the world camera, and so the crosshair and the shot ray, never do.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, SWITCH_SECONDS, RUN_SPEED } from '../shared/constants.js';
import { rayBox } from '../shared/collision.js';
import { self } from './net.js';

// ---- Look: every number an art pass may set. Metres, radians, seconds.
// Poses are [x, y, z, pitch, yaw, roll] in the camera's frame: x right,
// y up, -z ahead.
export const VM_FOV = 60; // vertical degrees, whatever FOV the player picks
export const VM_COLORS = { // neutral placeholders; the models name these keys
  metal: '#555a62', dark: '#3a3d43', polymer: '#666b74', detail: '#9aa0a9',
  glove: '#8d8478', sleeve: '#66707c', cuff: '#545c67',
};
export const VM_BOTTOM_SHADE = 0.3; // each box's lower vertices darken by this share: cheap baked AO
// Spring halflives: how long each motion takes to close half its gap.
export const LAG_HALFLIFE = 0.06; // mouse sway and strafe
export const BOB_HALFLIFE = 0.12; // bob fading in and out
export const BOUNCE_HALFLIFE = 0.08; // landing dip and jump
export const ACTION_HALFLIFE = 0.045; // reload, switch and pump poses; also smooths cancels
export const SHADE_HALFLIFE = 0.1; // stepping into and out of the sun's shadow
// Mouse sway: the gun trails the view by this much per rad/s of turn, up to a cap.
export const SWAY_ROT = 0.025;
export const SWAY_POS = 0.006;
export const SWAY_MAX_ROT = 0.08;
export const SWAY_MAX_POS = 0.015;
// Movement, at run speed: bank into a strafe and trail it; tuck in running forward.
export const STRAFE_ROLL = 0.06;
export const STRAFE_SHIFT = 0.012;
export const RUN_TUCK = 0.01;
// Bob: one dip per footstep, side to side over two; a slow breath when still.
export const BOB_STRIDE = 2.2; // metres per step, like the footstep sound
export const BOB_SIDE = 0.009;
export const BOB_DIP = 0.007;
export const BOB_ROLL = 0.015;
export const BOB_CROUCH = 0.5; // share of the bob while crouched
export const BREATH_PERIOD = 3.5;
export const BREATH_DIP = 0.0025;
export const BREATH_PITCH = 0.006;
// Landing dips the gun this much per m/s of fall (6.3 m/s from a full jump)
// above a threshold; taking off drops it a little.
export const LAND_DIP = 0.0045;
export const LAND_PITCH = 0.012;
export const LAND_MIN_SPEED = 2;
export const JUMP_DIP = 0.012;
// Switching: the old gun lowers to this pose, swaps at the bottom, the new one rises.
export const SWITCH_POSE = [0.03, -0.24, 0.06, -0.7, 0.12, 0.35];
export const KICK_VARIANCE = 0.3; // each shot's kick scales by 1 ± half this
// Muzzle flash: crossed additive star quads at a random roll, a glow sprite,
// and a one-frame emissive pulse on the arms and gun.
export const FLASH_COLOR = '#ffd08a';
export const FLASH_GLOW_COLOR = '#ff9f45';
export const FLASH_GLOW_SIZE = 2; // times the weapon's flash size
export const FLASH_SECONDS = 0.035; // and never less than one frame
export const FLASH_JITTER = 0.3; // random spread of the flash size
export const FLASH_TONGUE = [0.6, 1.4]; // width and length of the quads along the barrel, times the flash size
export const FLASH_POINTS = 6; // the star mask: points,
export const FLASH_RAYS = 6; // sharpness of its rays,
export const FLASH_CORE = 1.6; // brightness of its core,
export const FLASH_MASK_SIZE = 64; // and its texture size in pixels, as the glow's
export const FLASH_PULSE = '#ffb469';
export const FLASH_PULSE_STRENGTH = 0.08;

// Model data. A box is a part ('body' moves with the gun, 'part' is the
// magazine or pump, 'left' the left arm), a colour key, a size and a centre,
// with an optional rotation; a limb is a box of cross-section [w, h]
// stretched between two points. Gun space has its origin at the right hand
// on the grip.
const box = (part, color, size, at, rot) => ({ part, color, size, at, rot });
const limb = (part, color, size, from, to) => ({ part, color, size, from, to });
const add = (a, b) => a.map((v, i) => v + b[i]);
const toward = (a, b, d) => a.map((v, i) => v + ((b[i] - v) * d) / Math.hypot(...b.map((w, j) => w - a[j])));

// A right hand round a grip at `at`, the forearm running out to an elbow off-screen.
function rightArm(at, elbow) {
  const wrist = add(at, [0.014, -0.036, 0.04]);
  return [
    box('body', 'glove', [0.07, 0.086, 0.08], add(at, [0.008, -0.01, 0.002])), // fist
    box('body', 'glove', [0.02, 0.022, 0.06], add(at, [-0.033, 0.036, -0.014])), // thumb
    box('body', 'glove', [0.014, 0.016, 0.045], add(at, [-0.018, 0.024, -0.052])), // trigger finger
    limb('body', 'cuff', [0.094, 0.098], wrist, toward(wrist, elbow, 0.06)),
    limb('body', 'sleeve', [0.088, 0.092], toward(wrist, elbow, 0.05), elbow),
  ];
}

// A left hand cupping a handguard or pump whose centre line is at `at`: the
// back of the hand on the near side, fingers under and round.
function leftArm(at, elbow) {
  const wrist = add(at, [-0.03, -0.045, 0.055]);
  return [
    box('left', 'glove', [0.032, 0.075, 0.1], add(at, [-0.042, -0.012, 0])), // back of the hand
    box('left', 'glove', [0.075, 0.026, 0.09], add(at, [-0.008, -0.046, -0.002])), // fingers
    box('left', 'glove', [0.02, 0.022, 0.065], add(at, [-0.03, 0.034, -0.012])), // thumb
    limb('left', 'cuff', [0.094, 0.098], wrist, toward(wrist, elbow, 0.06)),
    limb('left', 'sleeve', [0.088, 0.092], toward(wrist, elbow, 0.05), elbow),
  ];
}

const PUMP = [[0.12], [0.3, 0, 0, 0.1], [0.46, 0, 0, 0.1], [0.62]];

// Per weapon: rest pose; muzzle point and flash size; recoil, as the peak
// offsets one shot reaches before its spring brings it back (back and lift
// in metres, up in radians, side and roll random up to that either way);
// pivots of the animated part and the left arm; the boxes; and keyframe
// tracks. A track is [t, x, y, z, pitch, yaw, roll] keys (missing values
// are 0), eased between keys and held past the ends; `reload` runs over the
// reload timer (per shell for the shotgun) and `cycle` over the fire
// cooldown after a shot.
export const MODELS = {
  rifle: {
    rest: [0.18, -0.205, -0.35, -0.025, 0.02, -0.04],
    muzzle: [0, 0.07, -0.74],
    flash: 0.16,
    kick: { back: 0.035, lift: 0.006, up: 0.05, side: 0.012, roll: 0.03, halflife: 0.05 },
    pivots: { part: [0, 0.03, -0.12], left: [0, 0.062, -0.38] },
    boxes: [
      box('body', 'metal', [0.05, 0.07, 0.3], [0, 0.065, -0.1]), // receiver
      box('body', 'dark', [0.034, 0.014, 0.28], [0, 0.107, -0.11]), // top rail
      box('body', 'polymer', [0.058, 0.062, 0.26], [0, 0.062, -0.38]), // handguard
      box('body', 'metal', [0.022, 0.022, 0.16], [0, 0.07, -0.59]), // barrel
      box('body', 'dark', [0.034, 0.034, 0.06], [0, 0.07, -0.7]), // muzzle brake
      box('body', 'dark', [0.012, 0.04, 0.02], [0, 0.11, -0.47]), // front sight
      box('body', 'dark', [0.03, 0.03, 0.035], [0, 0.127, 0.01]), // rear sight
      box('body', 'polymer', [0.034, 0.1, 0.046], [0, -0.012, 0.008], [-0.3, 0, 0]), // grip
      box('body', 'dark', [0.008, 0.01, 0.07], [0, 0.022, -0.05]), // trigger guard
      box('body', 'dark', [0.03, 0.035, 0.12], [0, 0.065, 0.11]), // buffer tube
      box('body', 'polymer', [0.042, 0.1, 0.06], [0, 0.045, 0.2]), // stock
      box('body', 'detail', [0.052, 0.022, 0.07], [0, 0.072, -0.07]), // ejection port
      box('part', 'dark', [0.032, 0.08, 0.06], [0, -0.005, -0.12], [0.12, 0, 0]), // magazine
      box('part', 'dark', [0.032, 0.07, 0.056], [0, -0.07, -0.135], [0.38, 0, 0]),
      ...rightArm([0, 0, 0], [0.17, -0.32, 0.34]),
      ...leftArm([0, 0.062, -0.38], [-0.24, -0.3, -0.06]),
    ],
    reload: {
      gun: [[0], [0.12, -0.05, 0.05, 0, 0.1, 0.15, -0.38], [0.78, -0.05, 0.05, 0, 0.1, 0.15, -0.38], [0.94]],
      part: [[0.12], [0.28, 0, -0.42, 0.05, -0.5], [0.5, 0, -0.42, 0.02], [0.6, 0, -0.12, 0.005], [0.68]],
      left: [[0.1], [0.24, -0.03, -0.32, 0.12], [0.5, 0, -0.39, 0.24], [0.6, 0.005, -0.25, 0.245], [0.68, 0.005, -0.13, 0.245], [0.74, 0.005, -0.15, 0.245], [0.86]],
    },
  },
  pistol: {
    rest: [0.15, -0.17, -0.36, -0.02, 0.14, -0.08],
    muzzle: [0, 0.075, -0.17],
    flash: 0.11,
    kick: { back: 0.03, lift: 0.012, up: 0.12, side: 0.015, roll: 0.03, halflife: 0.055 },
    pivots: { part: [0, -0.05, 0.02], left: [-0.035, -0.01, -0.01] },
    boxes: [
      box('body', 'metal', [0.032, 0.034, 0.19], [0, 0.075, -0.06]), // slide
      box('body', 'detail', [0.034, 0.02, 0.035], [0, 0.077, 0.012]), // serrations
      box('body', 'polymer', [0.03, 0.026, 0.155], [0, 0.047, -0.07]), // frame
      box('body', 'dark', [0.016, 0.016, 0.01], [0, 0.074, -0.157]), // barrel
      box('body', 'dark', [0.006, 0.01, 0.01], [0, 0.097, -0.14]), // front sight
      box('body', 'dark', [0.026, 0.012, 0.012], [0, 0.097, 0.024]), // rear sight
      box('body', 'polymer', [0.03, 0.095, 0.045], [0, -0.006, 0.012], [-0.22, 0, 0]), // grip
      box('body', 'dark', [0.006, 0.008, 0.045], [0, 0.02, -0.04]), // trigger guard
      box('part', 'dark', [0.024, 0.08, 0.034], [0, -0.008, 0.016], [-0.22, 0, 0]), // magazine, inside the grip
      box('part', 'dark', [0.034, 0.012, 0.05], [0, -0.058, 0.026], [-0.22, 0, 0]), // base plate
      ...rightArm([0, 0, 0], [0.15, -0.3, 0.32]),
      // The support hand wraps the right fist.
      box('left', 'glove', [0.03, 0.076, 0.076], [-0.042, -0.012, -0.004]),
      box('left', 'glove', [0.068, 0.05, 0.024], [-0.008, -0.022, -0.052]),
      box('left', 'glove', [0.018, 0.018, 0.05], [-0.03, 0.036, -0.04]),
      limb('left', 'cuff', [0.09, 0.094], [-0.06, -0.04, 0.03], [-0.08, -0.06, 0.07]),
      limb('left', 'sleeve', [0.084, 0.088], [-0.075, -0.055, 0.06], [-0.25, -0.3, 0.3]),
    ],
    reload: {
      gun: [[0], [0.12, -0.04, 0.05, 0.02, 0.3, 0.1, -0.3], [0.8, -0.04, 0.05, 0.02, 0.28, 0.1, -0.3], [0.94]],
      part: [[0.12], [0.26, 0, -0.38, 0.03, 0.3], [0.48, 0, -0.38, 0.02], [0.6, 0, -0.1, 0.01], [0.68]],
      left: [[0.1], [0.28, 0, -0.3, 0.08], [0.5, 0.03, -0.32, 0.05], [0.6, 0.035, -0.18, 0.04], [0.68, 0.035, -0.085, 0.04], [0.74, 0.035, -0.1, 0.04], [0.88]],
    },
  },
  shotgun: {
    rest: [0.18, -0.21, -0.35, -0.025, 0.02, -0.04],
    muzzle: [0, 0.085, -0.71],
    flash: 0.22,
    kick: { back: 0.07, lift: 0.01, up: 0.16, side: 0.02, roll: 0.05, halflife: 0.085 },
    pivots: { part: [0, 0.045, -0.36], left: [0, 0.045, -0.36] },
    boxes: [
      box('body', 'metal', [0.05, 0.072, 0.24], [0, 0.06, -0.08]), // receiver
      box('body', 'metal', [0.028, 0.028, 0.5], [0, 0.085, -0.45]), // barrel
      box('body', 'dark', [0.03, 0.03, 0.42], [0, 0.045, -0.41]), // magazine tube
      box('body', 'detail', [0.034, 0.034, 0.02], [0, 0.045, -0.63]), // tube cap
      box('body', 'dark', [0.01, 0.008, 0.46], [0, 0.103, -0.45]), // rib
      box('body', 'detail', [0.01, 0.012, 0.01], [0, 0.112, -0.69]), // bead
      box('body', 'polymer', [0.036, 0.1, 0.046], [0, -0.012, 0.008], [-0.3, 0, 0]), // grip
      box('body', 'dark', [0.008, 0.01, 0.06], [0, 0.02, -0.045]), // trigger guard
      box('body', 'polymer', [0.044, 0.08, 0.17], [0, 0.03, 0.125], [0.12, 0, 0]), // stock
      box('body', 'dark', [0.048, 0.11, 0.022], [0, 0.012, 0.215], [0.12, 0, 0]), // butt pad
      box('body', 'dark', [0.052, 0.014, 0.08], [0, 0.026, -0.1]), // loading port
      box('part', 'polymer', [0.052, 0.05, 0.15], [0, 0.045, -0.36]), // pump
      box('part', 'dark', [0.056, 0.01, 0.11], [0, 0.03, -0.36]), // pump grooves
      ...rightArm([0, 0, 0], [0.17, -0.32, 0.34]),
      ...leftArm([0, 0.045, -0.36], [-0.24, -0.3, -0.06]),
    ],
    reload: { // one shell; the gun stays tilted while the hand feeds the port
      gun: [[0, 0.01, 0.025, 0, 0.12, 0.06, -0.35]],
      left: [[0, 0.01, -0.04, 0.26], [0.35, 0, -0.005, 0.26], [0.6, 0, 0.01, 0.255], [1, 0.01, -0.04, 0.26]],
    },
    cycle: { gun: [[0.1], [0.3, 0, 0.012, 0, 0.06, 0, -0.08], [0.62]], part: PUMP, left: PUMP },
  },
};

// Box sizes [width, height, length] per weapon, for other players' guns.
export const GUN_SHAPES = { rifle: [0.045, 0.06, 0.5], pistol: [0.04, 0.07, 0.2], shotgun: [0.065, 0.065, 0.46] };

// ---- Springs and tracks: plain numbers, no allocation per frame.

// A critically damped spring per channel, exact for any dt (Holden,
// "Spring-It-On"): x eases to the goal with no overshoot, v carries kicks.
// goal null means 0.
export const spring = (n = 6) => ({ x: new Float64Array(n), v: new Float64Array(n) });
export function springStep(s, goal, halflife, dt) {
  const y = (2 * Math.LN2) / halflife;
  const e = Math.exp(-y * dt);
  for (let i = 0; i < s.x.length; i++) {
    const g = goal ? goal[i] : 0;
    const j0 = s.x[i] - g;
    const j1 = s.v[i] + j0 * y;
    s.x[i] = e * (j0 + j1 * dt) + g;
    s.v[i] = e * (s.v[i] - j1 * y * dt);
  }
}
// The velocity that makes a spring at rest peak at `peak`.
export const impulse = (peak, halflife) => (peak * Math.E * 2 * Math.LN2) / halflife;

const ease = (t) => t * t * (3 - 2 * t);

// Samples a track at t into out[0..5]; no track leaves out at 0.
export function sampleTrack(track, t, out) {
  out.fill(0);
  if (!track) return out;
  let i = 0;
  while (i < track.length - 1 && track[i + 1][0] <= t) i++;
  const a = track[i];
  const b = track[Math.min(i + 1, track.length - 1)];
  const u = b === a || t <= a[0] ? 0 : ease(Math.min(1, (t - a[0]) / (b[0] - a[0])));
  for (let k = 0; k < 6; k++) out[k] = (a[k + 1] ?? 0) + ((b[k + 1] ?? 0) - (a[k + 1] ?? 0)) * u;
  return out;
}

// ---- Scene: the viewmodel camera copies the world camera's turn each
// frame, so its scene shares the world's directions and mirrored lights
// light the gun as the world is lit. The gun hangs from the camera.
export const viewScene = new THREE.Scene();
export const viewCamera = new THREE.PerspectiveCamera(VM_FOV, 1, 0.01, 10);
const pose = new THREE.Group(); // the swaying, kicking root of the shown weapon
pose.name = 'viewmodel';
pose.visible = false; // until we have spawned
viewCamera.add(pose);
viewScene.add(viewCamera);

const material = new THREE.MeshLambertMaterial({ vertexColors: true }); // viewmodel-only: the flash pulses its emissive
const Z = new THREE.Vector3(0, 0, 1);

function boxGeometry(b) {
  const dir = b.from && new THREE.Vector3(...b.to).sub(new THREE.Vector3(...b.from));
  const g = new THREE.BoxGeometry(b.size[0], b.size[1], dir ? dir.length() : b.size[2]);
  const c = new THREE.Color(VM_COLORS[b.color]); // sRGB hex to linear
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = g.attributes.position.getY(i) < 0 ? 1 - VM_BOTTOM_SHADE : 1;
    colors.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (dir) {
    g.translate(0, 0, dir.length() / 2).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, dir.normalize()));
    return g.translate(...b.from);
  }
  if (b.rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...b.rot)));
  return g.translate(...b.at);
}

// One weapon: the gun and right arm, the part and the left arm, each one
// merged mesh, the last two pivoting where the data says.
function buildRig(name, m) {
  const group = new THREE.Group();
  group.name = name;
  group.visible = false;
  const mesh = (part, pivot = [0, 0, 0]) => {
    const geoms = m.boxes.filter((b) => b.part === part).map(boxGeometry);
    const merged = mergeGeometries(geoms).translate(-pivot[0], -pivot[1], -pivot[2]);
    geoms.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = part;
    mesh.position.fromArray(pivot);
    group.add(mesh);
    return mesh;
  };
  pose.add(group);
  mesh('body');
  return { group, part: mesh('part', m.pivots.part), left: mesh('left', m.pivots.left) };
}
const rigs = Object.fromEntries(Object.entries(MODELS).map(([name, m]) => [name, buildRig(name, m)]));

// Grey-scale masks made in code: a star with soft rays, and a round glow.
function maskTexture(size, f) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      data.set([255, 255, 255, 255 * Math.min(1, Math.max(0, f(Math.hypot(u, v), Math.atan2(u, v))))], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
const starTexture = maskTexture(FLASH_MASK_SIZE, (r, a) => {
  const k = Math.max(0, 1 - r);
  return FLASH_CORE * k ** 3 + Math.abs(Math.cos((a * FLASH_POINTS) / 2)) ** FLASH_RAYS * k * k;
});
const glowTexture = maskTexture(FLASH_MASK_SIZE, (r) => Math.max(0, 1 - r) ** 2);

// The flash: one quad facing the camera and two crossed along the barrel,
// showing the star's upper half as a tongue of flame; plus the glow.
const flash = new THREE.Group();
flash.name = 'flash';
{
  const tongue = new THREE.PlaneGeometry(...FLASH_TONGUE);
  const uv = tongue.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) / 2);
  tongue.rotateX(-Math.PI / 2).translate(0, 0, -FLASH_TONGUE[1] / 2);
  const quads = mergeGeometries([new THREE.PlaneGeometry(1, 1), tongue, tongue.clone().rotateZ(Math.PI / 2)]);
  const star = new THREE.Mesh(quads, new THREE.MeshBasicMaterial({ map: starTexture, color: FLASH_COLOR, side: THREE.DoubleSide, ...additive }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: FLASH_GLOW_COLOR, ...additive }));
  glow.scale.setScalar(FLASH_GLOW_SIZE);
  flash.add(star, glow);
  flash.visible = false;
  pose.add(flash);
}
const pulse = new THREE.Color(FLASH_PULSE).multiplyScalar(FLASH_PULSE_STRENGTH);

// ---- Lights: a stand-in until the world's are mirrored on the first frame
// it has any, then copied every frame so a retune of the world carries over.
const standIn = new THREE.HemisphereLight('#ffffff', '#555555', 2.5);
viewScene.add(standIn);
let mirrors = null; // { src: world light, copy: its viewmodel twin }
let sunCopy = null;
const shade = spring(1);
const shadeGoal = new Float64Array(1);
const target = new THREE.Vector3();

function mirrorLights(scene) {
  const found = [];
  scene.traverse((o) => { if (o.isHemisphereLight || o.isDirectionalLight || o.isAmbientLight) found.push(o); });
  mirrors = found.map((src) => ({ src, copy: new src.constructor() }));
  if (!mirrors.length) return;
  viewScene.remove(standIn);
  for (const { src, copy } of mirrors) {
    viewScene.add(copy);
    if (src.isDirectionalLight) sunCopy ??= copy;
  }
}

function syncLights(dt) {
  springStep(shade, shadeGoal, SHADE_HALFLIFE, dt);
  for (let i = 0; i < (mirrors?.length ?? 0); i++) {
    const { src, copy } = mirrors[i];
    copy.color.copy(src.color);
    copy.intensity = src.intensity;
    copy.position.setFromMatrixPosition(src.matrixWorld);
    if (src.isHemisphereLight) copy.groundColor.copy(src.groundColor);
    if (src.isDirectionalLight) {
      copy.position.sub(target.setFromMatrixPosition(src.target.matrixWorld));
      if (copy === sunCopy) copy.intensity *= 1 - shade.x[0] * (src.shadow?.intensity ?? 1);
    }
  }
}

// How much the eye is in the sun's shadow, 0 to 1; eased. The caller decides,
// e.g. from sunBlocked().
export function setSunShade(amount) {
  shadeGoal[0] = amount;
}

// Does any box ({ min, max }) hide the world's sun from this point?
const toSun = [0, 0, 0];
export function sunBlocked(point, boxes) {
  if (!sunCopy) return false;
  const d = sunCopy.position;
  const len = d.length() || 1;
  toSun[0] = d.x / len;
  toSun[1] = d.y / len;
  toSun[2] = d.z / len;
  for (let i = 0; i < boxes.length; i++) if (rayBox(point, toSun, boxes[i].min, boxes[i].max) < Infinity) return true;
  return false;
}

// ---- State.
let wanted = 'rifle'; // the weapon the arsenal holds
let shown = null; // the weapon on screen; lags `wanted` until a switch is down
let raise = false; // just became visible: come up from below
let shots = 0; // own shots since the last frame
let lastNow = null;
let lastYaw = 0;
let lastPitch = 0;
let turnYaw = 0; // rad/s
let turnPitch = 0;
let bobPhase = 0;
let wasGrounded = true;
let fallSpeed = 0;
let flashUntil = -Infinity;
const lag = spring();
const bounce = spring();
const kick = spring();
const action = spring();
const part = spring();
const left = spring();
const bobAmp = spring(1);
const goal = new Float64Array(6);
const partGoal = new Float64Array(6);
const leftGoal = new Float64Array(6);
const one = new Float64Array(1);
const sum = new Float64Array(6);
const clamp = (v, max) => Math.max(-max, Math.min(max, v));
const SNAP = 0.5; // rad in one frame: a respawn or a teleport, not a turn

export function setGun(weapon, visible) {
  wanted = MODELS[weapon] ? weapon : 'rifle';
  if (visible && !pose.visible) raise = true;
  pose.visible = visible;
}

// One of our own shots: kick the gun and flash the muzzle on the next frame.
export function gunKick() {
  shots++;
}

function show(weapon) {
  if (shown) rigs[shown].group.visible = false;
  shown = weapon;
  rigs[shown].group.visible = true;
  flash.position.fromArray(MODELS[shown].muzzle);
}

function place(mesh, pivot, x) {
  mesh.position.set(pivot[0] + x[0], pivot[1] + x[1], pivot[2] + x[2]);
  mesh.rotation.set(x[3], x[4], x[5]);
}

// Once per frame, after the world pass (it reads the world lights'
// matrices) and before the viewmodel's: the world camera and scene, to
// follow its turn and mirror its lights, and the renderer, to compile every
// viewmodel shader, hidden flash included, before the first shot needs it.
export function updateViewmodel(now, camera, scene, renderer) {
  const dt = lastNow === null ? 0 : Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  if (!mirrors && scene?.children.length) {
    mirrorLights(scene);
    renderer?.compile(viewScene, viewCamera);
  }
  syncLights(dt);
  viewCamera.quaternion.copy(camera.quaternion);
  if (viewCamera.aspect !== camera.aspect) {
    viewCamera.aspect = camera.aspect;
    viewCamera.updateProjectionMatrix();
  }
  const { mover, arsenal } = self;
  const fired = shots > 0;
  if (!pose.visible || !mover || !arsenal) {
    shots = 0;
    return;
  }
  if (shown !== wanted && (!shown || raise || arsenal.switching <= SWITCH_SECONDS / 2)) show(wanted);
  const m = MODELS[shown];
  const yaw = camera.rotation.y;
  const pitch = camera.rotation.x;
  if (raise) {
    raise = false;
    action.x.set(SWITCH_POSE);
    action.v.fill(0);
    lastYaw = yaw;
    lastPitch = pitch;
    turnYaw = turnPitch = 0;
    wasGrounded = mover.grounded;
  }

  // Sway trails the turn. A recoil kick turns the camera too, but the gun
  // leads that rather than trailing it, so a frame with a shot keeps the
  // last turn rate.
  const dy = yaw - lastYaw;
  const dp = pitch - lastPitch;
  lastYaw = yaw;
  lastPitch = pitch;
  if (dt > 0 && !fired && Math.abs(dy) < SNAP && Math.abs(dp) < SNAP) {
    turnYaw = dy / dt;
    turnPitch = dp / dt;
  }
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const side = clamp((mover.vx * cos - mover.vz * sin) / RUN_SPEED, 1);
  const ahead = clamp((-mover.vx * sin - mover.vz * cos) / RUN_SPEED, 1);
  goal[0] = clamp(turnYaw * SWAY_POS, SWAY_MAX_POS) - side * STRAFE_SHIFT;
  goal[1] = clamp(-turnPitch * SWAY_POS, SWAY_MAX_POS);
  goal[2] = Math.max(0, ahead) * RUN_TUCK;
  goal[3] = clamp(-turnPitch * SWAY_ROT, SWAY_MAX_ROT);
  goal[4] = clamp(-turnYaw * SWAY_ROT, SWAY_MAX_ROT);
  goal[5] = -side * STRAFE_ROLL;
  springStep(lag, goal, LAG_HALFLIFE, dt);

  // Bob with ground speed; breathe when still.
  const speed = Math.hypot(mover.vx, mover.vz);
  one[0] = mover.grounded ? Math.min(1, speed / RUN_SPEED) * (mover.crouch ? BOB_CROUCH : 1) : 0;
  springStep(bobAmp, one, BOB_HALFLIFE, dt);
  if (mover.grounded) bobPhase += (speed * dt * Math.PI) / BOB_STRIDE;
  const amp = bobAmp.x[0];
  const still = Math.max(0, 1 - amp) * Math.sin((now / 1000) * ((2 * Math.PI) / BREATH_PERIOD));

  // Land and take off. The step zeroes vy on touchdown, so the fall speed
  // is the last one seen in the air.
  if (!mover.grounded) fallSpeed = -mover.vy;
  else if (!wasGrounded && fallSpeed > LAND_MIN_SPEED) {
    bounce.v[1] -= impulse(LAND_DIP * fallSpeed, BOUNCE_HALFLIFE);
    bounce.v[3] -= impulse(LAND_PITCH * fallSpeed, BOUNCE_HALFLIFE);
  }
  if (wasGrounded && !mover.grounded && mover.vy > 0) bounce.v[1] -= impulse(JUMP_DIP, BOUNCE_HALFLIFE);
  wasGrounded = mover.grounded;
  springStep(bounce, null, BOUNCE_HALFLIFE, dt);

  // Recoil: each shot kicks back, up and a little aside.
  const k = m.kick;
  for (; shots > 0; shots--) {
    const r = 1 + (Math.random() - 0.5) * KICK_VARIANCE;
    kick.v[1] += impulse(k.lift * r, k.halflife);
    kick.v[2] += impulse(k.back * r, k.halflife);
    kick.v[3] += impulse(k.up * r, k.halflife);
    kick.v[4] += impulse(k.side * (Math.random() * 2 - 1), k.halflife);
    kick.v[5] += impulse(k.roll * (Math.random() * 2 - 1), k.halflife);
  }
  springStep(kick, null, k.halflife, dt);

  // Reload, pump and switch poses straight from the arsenal's timers.
  goal.fill(0);
  partGoal.fill(0);
  leftGoal.fill(0);
  const w = WEAPONS[shown];
  const tracks = shown !== wanted ? null : arsenal.reload > 0 ? m.reload : arsenal.cooldown > 0 ? m.cycle : null;
  if (tracks) {
    const t = tracks === m.reload ? 1 - arsenal.reload / w.reload : 1 - arsenal.cooldown * w.rps;
    sampleTrack(tracks.gun, t, goal);
    sampleTrack(tracks.part, t, partGoal);
    sampleTrack(tracks.left, t, leftGoal);
  }
  const s = arsenal.switching / SWITCH_SECONDS; // 1 → 0: the lowering peaks halfway
  const low = s > 0 ? ease(1 - Math.abs(2 * s - 1)) : 0;
  for (let i = 0; i < 6; i++) goal[i] += SWITCH_POSE[i] * low;
  springStep(action, goal, ACTION_HALFLIFE, dt);
  springStep(part, partGoal, ACTION_HALFLIFE, dt);
  springStep(left, leftGoal, ACTION_HALFLIFE, dt);

  const c = Math.cos(bobPhase);
  for (let i = 0; i < 6; i++) sum[i] = m.rest[i] + lag.x[i] + bounce.x[i] + kick.x[i] + action.x[i];
  sum[0] += c * BOB_SIDE * amp;
  sum[1] += -(Math.sin(bobPhase) ** 2) * BOB_DIP * amp + still * BREATH_DIP;
  sum[3] += still * BREATH_PITCH;
  sum[5] += c * BOB_ROLL * amp;
  pose.position.set(sum[0], sum[1], sum[2]);
  pose.rotation.set(sum[3], sum[4], sum[5]);
  place(rigs[shown].part, m.pivots.part, part.x);
  place(rigs[shown].left, m.pivots.left, left.x);

  // The flash shows for FLASH_SECONDS but at least one frame; the gun's
  // emissive pulses for exactly one.
  if (fired) {
    flashUntil = now + FLASH_SECONDS * 1000;
    flash.rotation.z = Math.random() * 2 * Math.PI;
    flash.scale.setScalar(m.flash * (1 + (Math.random() - 0.5) * FLASH_JITTER));
    material.emissive.copy(pulse);
  } else material.emissive.setRGB(0, 0, 0);
  flash.visible = fired || now < flashUntil;
}

// Where the muzzle shows on screen, as the point as far along the world
// camera's ray through that pixel, so world effects such as tracers can
// start at the gun. Valid after a frame has been drawn.
const muzzle = new THREE.Vector3();
export function muzzleWorld(camera, out = new THREE.Vector3()) {
  flash.getWorldPosition(muzzle);
  const dist = muzzle.length();
  muzzle.project(viewCamera);
  return out.set(muzzle.x, muzzle.y, 0.5).unproject(camera).sub(camera.position).setLength(dist).add(camera.position);
}
