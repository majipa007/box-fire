// First-person arms and gun (bible §3.2). Each weapon is a few dozen boxes
// from the data below, merged into one skinned, vertex-coloured mesh: one
// draw for the gun and both arms, with bones for what moves on its own (the
// magazine or pump, the left hand, the pistol's slide, a shell in the hand).
// Springs move it with the mouse, strafing and recoil; footsteps, landings,
// reloads, pumps and switches follow the mover and the arsenal's own timers,
// so prediction, cancels and corrections need nothing extra. It has its own
// scene and camera, drawn after the world with the depth buffer cleared, so
// it never clips into a wall and keeps its shape whatever FOV the player
// picks. Only the viewmodel moves: the world camera, and so the crosshair and
// the shot ray, never do.
//
// Draws: the gun 1, the muzzle flash 1 (star and glow in one mesh), our own
// casings 1. ?debug&vm=<weapon>:<idle|recoil|reload|switch>:<0..1>[:shade]
// pins a pose for look-dev shots.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS, SWITCH_SECONDS, RUN_SPEED } from '../shared/constants.js';
import { rayBox } from '../shared/collision.js';
import { self } from './net.js';

const DEG = Math.PI / 180;

// ---- Look: every number an art pass may set. Metres, radians, seconds.
// Poses are [x, y, z, pitch, yaw, roll] in the camera's frame: x right,
// y up, -z ahead.
export const LOOK = {
  fov: 60, // vertical degrees, whatever FOV the player picks
  colors: {
    metal: '#2e3136', tan: '#b9a27a', dark: '#1b1d22', kit: '#24272d', glove: '#3a3d44',
    shell: '#b33a2e', brass: '#c9a24e', slot: '#ffffff', // slot boxes take setArmband's colour
  },
  // Surface. Blinn-Phong strength of the sun's highlight per colour key.
  shine: { metal: 0.6, dark: 0.12, tan: 0.12, kit: 0.08, glove: 0.25, shell: 0.3, brass: 0.9, slot: 0.2 },
  shininess: 90, // tight, so flat faces glint at an angle rather than glaze over
  bevel: 0.004, // m: the band along every box edge that catches the light,
  bevelLift: 2, // where the albedo becomes albedo × (1 + lift) + add,
  bevelAdd: 0.06, // and the highlight doubles;
  bevelCatch: 0.3, // share of that kept on downward faces; upward faces catch the sky in full
  groove: [0.008, 0.0095, 0.55, 0.045], // and a panel line this far in (from, to), darkened to this share, on faces wider than the last
  // The sky light's colours reflected off each face (ground below, sky above),
  // × shine and a Schlick fresnel: metal reads as metal, and every part
  // keeps a rim where it turns away from us.
  env: 0.16, // reflection gain at full shine
  envFloor: 0.3, // share of it facing us; the rest comes in at grazing angles
  rim: 0.06, // fresnel rim on every surface, shine or not,
  sheen: { kit: 0.35, glove: 0.3 }, // and stronger on cloth: dark sleeves and gloves read by their edges
  grain: 0.08, // ± share of the albedo per grain voxel: pixel-art texture with no texture
  grainSize: 0.004, // m
  bottomShade: 0.3, // each box's lower vertices darken by this share: cheap baked AO
  lift: 0.25, // share of the albedo added unlit, so dark kit keeps its shape in shade
  shadeSun: 0.45, // the sun's share when the eye is in its shadow,
  shadeHalflife: 0.05, // eased over about 150 ms
  idle: 0.003, // m, a slow breath when still,
  idleHz: 0.25,
  // Mouse sway, per pixel of mouse in a 60 Hz frame at the default
  // sensitivity (0.002 rad/px), clamped; the look-lag trails the same way.
  sway: { rotPerPx: 0.0008, posPerPx: 0.0006, maxRot: 3 * DEG, maxPos: 0.03, pxPerRad: 500, halflife: 0.06 },
  strafeRoll: -4 * DEG, // at full strafe speed to the right
  strafeHalflife: 0.08,
  bob: { side: 0.006, dip: 0.004, cycle: 4.4, crouch: 0.5, halflife: 0.12 }, // figure-8, 12 × 8 mm per two steps
  land: { perSpeed: 0.006, max: 0.03, pitch: 0.5, down: 0.07, back: 0.14, minSpeed: 2 }, // pitch: rad per m of dip
  switchPose: { y: -0.25, pitch: -30 * DEG, out: 0.15, back: 1.04 }, // back 1.04: a 4% overshoot on the way in
  cast: { dip: 0.04, roll: 4 * DEG, seconds: 0.12 }, // using a power-up
  actionHalflife: 0.045, // reload and pump poses; also smooths cancels
  flash: {
    core: '#ffd27a', edge: '#ff8a3d', frames: 2, jitter: 0.3, // star: crossed additive quads at a random roll
    tongue: [0.6, 1.4], points: 6, rays: 6, coreGain: 1.6, // quads along the barrel, × the flash size; the star mask
    glow: 0.5, glowColor: '#ff9a4a', glowAlpha: 0.45, glowSeconds: 0.05,
    pulse: '#ff9a4a', pulseGain: 0.6, pulseSeconds: 0.04, // emissive on the barrel boxes
    hemiBoost: 0.3, // the view's sky light rises this share while the barrel glows
  },
  casings: {
    pool: 16, velocity: [2, 1.6, 0.3], spread: 0.15, spin: 15, life: 0.45, gravity: 9.8,
    size: { rifle: [0.012, 0.035], pistol: [0.01, 0.022], shotgun: [0.024, 0.06] }, // diameter, length
  },
};

// ---- Model data. A box is a bone ('body' moves with the gun, 'part' is the
// magazine or pump, 'left' the left arm, 'slide' the pistol's slide, 'shell'
// a shell in the left hand), a colour key, a size and a centre, with an
// optional rotation; a limb is a box of cross-section [w, h] stretched
// between two points; hot boxes glow when the gun fires. Gun space has its
// origin at the right hand on the grip, and the rest pose puts that point
// where the bible's table puts the gun: `rest` places the receiver's centre,
// `anchor`, in camera space.
const box = (part, color, size, at, rot) => ({ part, color, size, at, rot });
const limb = (part, color, size, from, to) => ({ part, color, size, from, to });
const hot = (b) => Object.assign(b, { hot: true });
const add = (a, b) => a.map((v, i) => v + b[i]);
const toward = (a, b, d) => a.map((v, i) => v + ((b[i] - v) * d) / Math.hypot(...b.map((w, j) => w - a[j])));

// The right hand round the grip; armband and forearm run off toward an
// elbow below the screen. 1.15 × the third-person arm.
function rightArm(elbow) {
  const wrist = [0.012, -0.04, 0.055];
  const band = toward(wrist, elbow, 0.04);
  return [
    box('body', 'glove', [0.105, 0.105, 0.115], [0.006, -0.014, 0.006]), // fist
    box('body', 'glove', [0.028, 0.03, 0.075], [-0.05, 0.042, -0.03]), // thumb along the receiver
    box('body', 'glove', [0.02, 0.02, 0.05], [-0.024, 0.012, -0.068]), // trigger finger
    ...[0, 1, 2].map((k) => box('body', 'glove', [0.022, 0.024, 0.07], [-0.047, -0.002 - k * 0.027, -0.014 - k * 0.004])), // fingers round the grip
    limb('body', 'slot', [0.12, 0.12], wrist, band), // armband
    limb('body', 'kit', [0.115, 0.115], band, toward(band, elbow, 0.32)), // forearm
  ];
}

// The left hand under a handguard or pump whose centre line is at `at`; the
// upper arm carries the sleeve off the bottom of the screen.
function leftArm(at, elbow, part = 'left') {
  const wrist = add(at, [-0.03, -0.085, 0.06]);
  const band = toward(wrist, elbow, 0.04);
  const fore = toward(band, elbow, 0.32);
  return [
    box(part, 'glove', [0.105, 0.105, 0.115], add(at, [-0.016, -0.062, 0.004])), // palm and fingers under
    box(part, 'glove', [0.026, 0.026, 0.07], add(at, [-0.04, 0.012, -0.016])), // thumb along the near side
    limb(part, 'slot', [0.12, 0.12], wrist, band),
    limb(part, 'kit', [0.115, 0.115], band, fore),
    limb(part, 'kit', [0.125, 0.125], fore, toward(fore, elbow, 0.3)),
  ];
}

// Per weapon: rest pose; muzzle point, flash size and ejection port;
// recoil, as the peak offsets one shot reaches before its spring brings it
// back (back in metres, up and roll in radians, the roll random either way);
// bone pivots; the boxes; and keyframe tracks. A track is [t, x, y, z,
// pitch, yaw, roll] keys (missing values are 0), eased between keys and held
// past the ends. `reload` runs over the reload timer as a fraction (per shell
// for the shotgun); `cycle` over the seconds since a shot.
export const MODELS = {
  rifle: {
    rest: [0.2, -0.19, -0.6, 0.03, 0.08, 0],
    anchor: [0, 0.075, -0.07],
    muzzle: [0, 0.075, -0.765],
    flash: 0.18,
    port: [0.035, 0.085, -0.03],
    kick: { back: 0.035, up: 2.5 * DEG, roll: 1.5 * DEG, halflife: 0.045 },
    pivots: { part: [0, 0.03, -0.15], left: [0, 0.075, -0.36] },
    boxes: [
      box('body', 'metal', [0.06, 0.08, 0.36], [0, 0.075, -0.07]), // receiver
      box('body', 'dark', [0.034, 0.012, 0.3], [0, 0.121, -0.08]), // top rail
      box('body', 'dark', [0.034, 0.03, 0.04], [0, 0.142, 0.06]), // rear sight
      box('body', 'dark', [0.012, 0.05, 0.02], [0, 0.13, -0.44]), // front sight
      box('body', 'metal', [0.04, 0.012, 0.03], [0, 0.121, 0.11]), // charging handle
      box('body', 'slot', [0.062, 0.01, 0.08], [0, 0.1, -0.17]), // slot stripe
      box('body', 'metal', [0.064, 0.03, 0.08], [0, 0.03, -0.15]), // magazine well
      box('body', 'dark', [0.034, 0.09, 0.05], [0, -0.005, 0.01], [-15 * DEG, 0, 0]), // grip
      box('body', 'dark', [0.01, 0.01, 0.07], [0, 0, -0.065]), // trigger guard
      box('body', 'tan', [0.055, 0.06, 0.22], [0, 0.075, -0.36]), // handguard
      box('body', 'dark', [0.03, 0.01, 0.2], [0, 0.11, -0.36]), // handguard rail
      hot(box('body', 'dark', [0.035, 0.04, 0.03], [0, 0.075, -0.49])), // gas block
      hot(box('body', 'metal', [0.025, 0.025, 0.3], [0, 0.075, -0.58])), // barrel
      hot(box('body', 'dark', [0.035, 0.035, 0.035], [0, 0.075, -0.745])), // brake
      box('body', 'dark', [0.03, 0.035, 0.1], [0, 0.085, 0.16]), // buffer tube
      box('body', 'dark', [0.05, 0.08, 0.2], [0, 0.065, 0.26]), // stock
      box('body', 'dark', [0.054, 0.086, 0.02], [0, 0.065, 0.37]), // butt pad
      box('part', 'dark', [0.045, 0.08, 0.07], [0, -0.02, -0.15], [0.1, 0, 0]), // curved magazine
      box('part', 'dark', [0.045, 0.07, 0.065], [0, -0.085, -0.172], [0.35, 0, 0]),
      ...rightArm([0.17, -0.32, 0.34]),
      ...leftArm([0, 0.075, -0.36], [-0.24, -0.3, -0.06]),
    ],
    // Tilt 25° over 0–0.14, magazine out 0.14–0.32, in 0.32–0.64, bolt slap at 0.76.
    reload: {
      gun: [[0], [0.14, -0.03, 0.07, 0.04, 0.18, 0.12, -25 * DEG], [0.72, -0.03, 0.07, 0.04, 0.18, 0.12, -25 * DEG],
        [0.76, -0.03, 0.062, 0.056, 0.23, 0.12, -22 * DEG], [0.8, -0.03, 0.07, 0.04, 0.18, 0.12, -25 * DEG], [0.94]],
      part: [[0.14], [0.32, 0, -0.45, 0.04, -0.4], [0.44, 0, -0.15, 0.03, 0.1], [0.56, 0, -0.05, 0.005], [0.64]],
      left: [[0.1], [0.3, -0.02, -0.42, 0.2, 0.3], [0.44, 0, -0.24, 0.21], [0.56, 0.005, -0.16, 0.21], [0.64, 0.005, -0.12, 0.21],
        [0.71, -0.045, -0.02, 0.27], [0.76, -0.04, -0.01, 0.25], [0.88]],
    },
  },
  pistol: {
    rest: [0.17, -0.17, -0.5, 0, 0.1, 0],
    anchor: [0, 0.06, -0.055],
    muzzle: [0, 0.078, -0.17],
    flash: 0.12,
    port: [0.02, 0.085, -0.02],
    kick: { back: 0.05, up: 4 * DEG, roll: 1.5 * DEG, halflife: 0.06 },
    pivots: { part: [0, -0.03, 0.015], left: [-0.04, -0.01, -0.01] },
    boxes: [
      box('slide', 'metal', [0.035, 0.04, 0.19], [0, 0.075, -0.055]), // slide
      box('slide', 'dark', [0.037, 0.026, 0.035], [0, 0.078, 0.015]), // serrations
      box('slide', 'dark', [0.008, 0.012, 0.012], [0, 0.1, -0.138]), // front sight
      box('slide', 'dark', [0.03, 0.012, 0.012], [0, 0.1, 0.028]), // rear sight
      hot(box('body', 'dark', [0.018, 0.018, 0.012], [0, 0.078, -0.153])), // barrel
      box('body', 'dark', [0.03, 0.03, 0.16], [0, 0.04, -0.06]), // frame
      box('body', 'tan', [0.032, 0.11, 0.05], [0, -0.02, 0.012], [-12 * DEG, 0, 0]), // grip
      box('body', 'dark', [0.008, 0.01, 0.05], [0, 0.01, -0.05]), // trigger guard
      box('part', 'dark', [0.024, 0.1, 0.038], [0, -0.025, 0.014], [-12 * DEG, 0, 0]), // magazine, inside the grip
      box('part', 'dark', [0.036, 0.012, 0.055], [0, -0.078, 0.024], [-12 * DEG, 0, 0]), // base plate
      ...rightArm([0.15, -0.3, 0.32]),
      // The support hand wraps the right fist.
      box('left', 'glove', [0.105, 0.09, 0.1], [-0.052, -0.026, -0.004]),
      box('left', 'glove', [0.06, 0.045, 0.03], [-0.012, -0.03, -0.058]),
      box('left', 'glove', [0.024, 0.024, 0.06], [-0.036, 0.04, -0.04]),
      ...[0, 1, 2].map((k) => box('left', 'glove', [0.018, 0.024, 0.07], [-0.106, 0.008 - k * 0.027, -0.012 - k * 0.004])), // fingers
      limb('left', 'slot', [0.12, 0.12], [-0.075, -0.06, 0.035], [-0.09, -0.08, 0.07]),
      limb('left', 'kit', [0.115, 0.115], [-0.09, -0.08, 0.07], [-0.2, -0.24, 0.3]),
      limb('left', 'kit', [0.125, 0.125], [-0.2, -0.24, 0.3], [-0.32, -0.42, 0.5]),
    ],
    // The rifle's fractions over 1.75 s; the support hand racks the slide at the end.
    reload: {
      gun: [[0], [0.14, -0.03, 0.05, 0.02, 0.3, 0.1, -0.3], [0.8, -0.03, 0.05, 0.02, 0.28, 0.1, -0.3], [0.94]],
      part: [[0.14], [0.32, 0, -0.36, 0.03, 0.3], [0.44, 0, -0.14, 0.02], [0.56, 0, -0.05, 0.01], [0.64]],
      left: [[0.1], [0.3, 0.02, -0.36, 0.05], [0.44, 0.04, -0.2, 0.04], [0.56, 0.04, -0.14, 0.03], [0.64, 0.04, -0.11, 0.03],
        [0.71, 0.03, 0.1, 0.07], [0.76, 0.03, 0.1, 0.1], [0.88]],
      slide: [[0.72], [0.76, 0, 0, 0.03], [0.78]],
    },
    cycle: { slide: [[0, 0, 0, 0.03], [0.06]] }, // slide recoils 0.03 m
  },
  shotgun: {
    rest: [0.2, -0.2, -0.58, 0.03, 0.08, 0],
    anchor: [0, 0.07, -0.08],
    muzzle: [0, 0.09, -0.61],
    flash: 0.28,
    port: [0.035, 0.07, -0.09],
    kick: { back: 0.09, up: 7 * DEG, roll: 1.5 * DEG, halflife: 0.09 },
    pivots: { part: [0, 0.05, -0.36], left: [0, 0.05, -0.36] },
    boxes: [
      box('body', 'metal', [0.06, 0.08, 0.2], [0, 0.07, -0.08]), // receiver
      hot(box('body', 'metal', [0.035, 0.035, 0.42], [0, 0.09, -0.39])), // barrel
      box('body', 'dark', [0.03, 0.03, 0.36], [0, 0.05, -0.36]), // magazine tube
      box('body', 'metal', [0.034, 0.034, 0.02], [0, 0.05, -0.55]), // tube cap
      box('body', 'dark', [0.01, 0.008, 0.4], [0, 0.111, -0.39]), // rib
      hot(box('body', 'brass', [0.01, 0.01, 0.01], [0, 0.12, -0.595])), // bead
      box('body', 'dark', [0.036, 0.1, 0.046], [0, -0.005, 0.01], [-0.3, 0, 0]), // grip
      box('body', 'dark', [0.01, 0.01, 0.06], [0, 0.015, -0.05]), // trigger guard
      box('body', 'tan', [0.05, 0.09, 0.24], [0, 0.05, 0.14], [0.1, 0, 0]), // stock
      box('body', 'dark', [0.054, 0.1, 0.02], [0, 0.038, 0.265], [0.1, 0, 0]), // butt pad
      ...[-0.13, -0.1, -0.07, -0.04].map((z) => box('body', 'shell', [0.024, 0.06, 0.024], [-0.042, 0.07, z])), // side saddle
      box('part', 'tan', [0.055, 0.055, 0.14], [0, 0.05, -0.36]), // pump
      box('part', 'dark', [0.058, 0.008, 0.1], [0, 0.034, -0.36]), // pump grooves
      box('shell', 'shell', [0.024, 0.024, 0.06], [-0.012, 0.012, -0.36]), // the shell being loaded, in the left hand
      ...rightArm([0.17, -0.32, 0.34]),
      ...leftArm([0, 0.05, -0.36], [-0.24, -0.3, -0.06]),
    ],
    // One shell per 0.5 s: tilted 10°, hand to the port 0–0.25 s, insert 0.25–0.40 s, back 0.40–0.50 s.
    reload: {
      gun: [[0, 0.01, 0.02, 0, 0.1, 0.05, -10 * DEG]],
      left: [[0, 0, -0.14, 0.2], [0.5, 0, -0.075, 0.27], [0.8, 0, -0.045, 0.26], [1, 0, -0.14, 0.2]],
    },
    shellUntil: 0.8, // the shell shows in the hand until it is pushed in
    eject: 0.43, // seconds after a shot: the pump is back and the shell flies
    // Racks 0.07 m from 300 to 560 ms after each shot.
    cycle: {
      gun: [[0.28], [0.43, 0, 0.005, 0, 0.04, 0, -0.05], [0.6]],
      part: [[0.3], [0.43, 0, 0, 0.07], [0.56]],
      left: [[0.3], [0.43, 0, 0, 0.07], [0.56]],
    },
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
// The velocity that makes a spring at rest peak at `peak`, and the share of
// that peak it shows t seconds after the kick.
export const impulse = (peak, halflife) => (peak * Math.E * 2 * Math.LN2) / halflife;
const impulseShape = (t, halflife) => {
  const k = (t * 2 * Math.LN2) / halflife;
  return k * Math.exp(1 - k);
};

const ease = (t) => t * t * (3 - 2 * t);
// Ease out past 1 and back: s = 1.04 overshoots by 4%.
const easeBack = (t, s) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

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

// How far down a switch has the gun t seconds in: out over the first
// LOOK.switchPose.out, then back up with a small overshoot (negative).
export function switchLow(t) {
  const { out, back } = LOOK.switchPose;
  if (t < 0 || t >= SWITCH_SECONDS) return 0;
  return t < out ? ease(t / out) : 1 - easeBack((t - out) / (SWITCH_SECONDS - out), back);
}

// ---- Scene: the viewmodel camera copies the world camera's turn each
// frame, so its scene shares the world's directions and mirrored lights
// light the gun as the world is lit. The gun hangs from the camera.
export const viewScene = new THREE.Scene();
export const viewCamera = new THREE.PerspectiveCamera(LOOK.fov, 1, 0.01, 10);
const pose = new THREE.Group(); // the swaying, kicking root of the shown weapon
pose.name = 'viewmodel';
pose.visible = false; // until we have spawned
viewCamera.add(pose);
viewScene.add(viewCamera);

// One material for every gun: vertex colours and Blinn-Phong, plus bevelled
// edges, a grain, an unlit lift, the slot colour and the barrel's glow,
// patched into three's shader.
const f = (x) => x.toFixed(5);
const vmUniforms = {
  vmSlot: { value: new THREE.Color('#ffffff') }, vmPulse: { value: new THREE.Color(0, 0, 0) },
};
const material = new THREE.MeshPhongMaterial({ vertexColors: true, specular: '#ffffff', shininess: LOOK.shininess });
material.onBeforeCompile = (s) => {
  Object.assign(s.uniforms, vmUniforms);
  const decl = 'varying vec4 vEdge;\nvarying vec4 vMat;\nvarying vec3 vGrain;\n';
  s.vertexShader = s.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec4 edge;\nattribute vec4 mat;\n${decl}`)
    .replace('#include <color_vertex>', `#include <color_vertex>
      vEdge = edge;
      vMat = mat;
      vGrain = ( position - normal * 0.001 ) / ${f(LOOK.grainSize)};`);
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec3 vmSlot;\nuniform vec3 vmPulse;\n${decl}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix( vec3( 1.0 ), vmSlot, vMat.z );
      diffuseColor.rgb *= 1.0 + ${f(2 * LOOK.grain)} * ( fract( sin( dot( floor( vGrain ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) - 0.5 );
      float vmEdge = min( min( vEdge.x, vEdge.z - vEdge.x ), min( vEdge.y, vEdge.w - vEdge.y ) );
      float vmBevel = 1.0 - smoothstep( ${f(LOOK.bevel * 0.5)}, ${f(LOOK.bevel)}, vmEdge );
      #if NUM_HEMI_LIGHTS > 0
        vmBevel *= mix( ${f(LOOK.bevelCatch)}, 1.0, dot( normalize( vNormal ), hemisphereLights[ 0 ].direction ) * 0.5 + 0.5 );
      #endif
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ${f(1 + LOOK.bevelLift)} + ${f(LOOK.bevelAdd)}, vmBevel );
      if ( min( vEdge.z, vEdge.w ) > ${f(LOOK.groove[3])} && vmEdge > ${f(LOOK.groove[0])} && vmEdge < ${f(LOOK.groove[1])} ) diffuseColor.rgb *= ${f(LOOK.groove[2])};`)
    .replace('#include <specularmap_fragment>', 'float specularStrength = vMat.x * ( 1.0 + vmBevel );')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * ${f(LOOK.lift)} + vmPulse * vMat.y;
      #if NUM_HEMI_LIGHTS > 0
        vec3 vmV = normalize( vViewPosition );
        float vmF = pow( 1.0 - saturate( dot( normal, vmV ) ), 5.0 );
        float vmUp = dot( reflect( - vmV, normal ), hemisphereLights[ 0 ].direction ) * 0.5 + 0.5;
        vec3 vmEnv = mix( hemisphereLights[ 0 ].groundColor, hemisphereLights[ 0 ].skyColor, vmUp );
        totalEmissiveRadiance += vmEnv * ( ${f(LOOK.env)} * vMat.x * mix( ${f(LOOK.envFloor)}, 1.0, vmF ) * ( 1.0 + vmBevel ) + vMat.w * vmF );
      #endif`);
};

const BONES = ['body', 'part', 'left', 'slide', 'shell'];
const Z = new THREE.Vector3(0, 0, 1);

// One box: its colour (lower half shaded), the face-local edge distances
// (u·w, v·h, w, h) the bevel needs, its surface (shine, hot, slot, rim) and its bone.
function boxGeometry(b) {
  const dir = b.from && new THREE.Vector3(...b.to).sub(new THREE.Vector3(...b.from));
  const [w, h, d] = [b.size[0], b.size[1], dir ? dir.length() : b.size[2]];
  const g = new THREE.BoxGeometry(w, h, d);
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // BoxGeometry's px, nx, py, ny, pz, nz
  const c = new THREE.Color(LOOK.colors[b.color]); // sRGB hex to linear
  const n = g.attributes.position.count;
  const color = new Float32Array(n * 3);
  const edge = new Float32Array(n * 4);
  const mat = new Float32Array(n * 4);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const uv = g.attributes.uv;
  for (let i = 0; i < n; i++) {
    const k = g.attributes.position.getY(i) < 0 ? 1 - LOOK.bottomShade : 1;
    color.set([c.r * k, c.g * k, c.b * k], i * 3);
    const [fu, fv] = faces[i >> 2];
    edge.set([uv.getX(i) * fu, uv.getY(i) * fv, fu, fv], i * 4);
    mat.set([LOOK.shine[b.color], b.hot ? 1 : 0, b.color === 'slot' ? 1 : 0, LOOK.sheen[b.color] ?? LOOK.rim], i * 4);
    skinIndex[i * 4] = BONES.indexOf(b.part);
    skinWeight[i * 4] = 1;
  }
  g.deleteAttribute('uv');
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('edge', new THREE.BufferAttribute(edge, 4));
  g.setAttribute('mat', new THREE.BufferAttribute(mat, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  if (dir) {
    g.translate(0, 0, d / 2).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, dir.normalize()));
    return g.translate(...b.from);
  }
  if (b.rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...b.rot)));
  return g.translate(...b.at);
}

// One weapon: a skinned mesh, bound with every bone at rest. The gun turns
// about the grip, so its base pose puts the grip where the rest pose, turned
// about the anchor, needs it.
function buildRig(name, m) {
  const turn = new THREE.Euler(m.rest[3], m.rest[4], m.rest[5]);
  m.base = [...new THREE.Vector3(...m.anchor).applyEuler(turn).negate().add(new THREE.Vector3(...m.rest)).toArray(), ...m.rest.slice(3)];
  const geoms = m.boxes.map(boxGeometry);
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geoms), material);
  geoms.forEach((g) => g.dispose());
  mesh.name = name;
  mesh.visible = false;
  mesh.frustumCulled = false; // always in view; skips a per-frame skinned bounds pass
  const bones = Object.fromEntries(BONES.map((b) => [b, new THREE.Bone()]));
  bones.body.add(bones.part, bones.left, bones.slide);
  bones.left.add(bones.shell);
  bones.part.position.fromArray(m.pivots.part);
  bones.left.position.fromArray(m.pivots.left);
  mesh.add(bones.body);
  pose.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map((b) => bones[b])));
  bones.shell.scale.setScalar(0);
  return { mesh, bones };
}
const rigs = Object.fromEntries(Object.entries(MODELS).map(([name, m]) => [name, buildRig(name, m)]));

// ---- Muzzle flash: a star facing the camera and two quads crossed along
// the barrel, showing its upper half as a tongue of flame, plus a round
// glow, all in one additive mesh. The masks are maths in the shader.
const flashUniforms = {
  star: { value: 0 }, glow: { value: 0 }, starSize: { value: 1 }, glowSize: { value: LOOK.flash.glow },
  core: { value: new THREE.Color(LOOK.flash.core) }, edge: { value: new THREE.Color(LOOK.flash.edge) },
  glowColor: { value: new THREE.Color(LOOK.flash.glowColor) },
};
const flashMesh = new THREE.Mesh(
  (() => {
    const tongue = new THREE.PlaneGeometry(...LOOK.flash.tongue);
    const uv = tongue.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) / 2);
    tongue.rotateX(-Math.PI / 2).translate(0, 0, -LOOK.flash.tongue[1] / 2);
    const parts = [new THREE.PlaneGeometry(1, 1), tongue, tongue.clone().rotateZ(Math.PI / 2), new THREE.PlaneGeometry(1, 1)];
    parts.forEach((g, i) => g.setAttribute('layer', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(i === 3 ? 1 : 0), 1)));
    return mergeGeometries(parts);
  })(),
  new THREE.ShaderMaterial({
    uniforms: flashUniforms,
    vertexShader: `attribute float layer;
      uniform float starSize, glowSize;
      varying vec2 vUv;
      varying float vLayer;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vLayer = layer;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position * ( layer > 0.5 ? glowSize : starSize ), 1.0 );
      }`,
    fragmentShader: `uniform float star, glow;
      uniform vec3 core, edge, glowColor;
      varying vec2 vUv;
      varying float vLayer;
      void main() {
        float k = max( 0.0, 1.0 - length( vUv ) );
        vec3 c = glowColor;
        float a = glow * ${f(LOOK.flash.glowAlpha)} * k * k;
        if ( vLayer < 0.5 ) {
          float m = ${f(LOOK.flash.coreGain)} * k * k * k + pow( abs( cos( atan( vUv.x, vUv.y ) * ${f(LOOK.flash.points / 2)} ) ), ${f(LOOK.flash.rays)} ) * k * k;
          c = mix( edge, core, clamp( m * 1.5 - 0.3, 0.0, 1.0 ) );
          a = star * min( 1.0, 1.6 * m );
        }
        gl_FragColor = vec4( c, a );
        #include <colorspace_fragment>
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  }),
);
flashMesh.name = 'flash';
flashMesh.frustumCulled = false;
flashMesh.visible = false;
pose.add(flashMesh);
const pulse = new THREE.Color(LOOK.flash.pulse).multiplyScalar(LOOK.flash.pulseGain);

// ---- Our own casings: a pooled instanced box in the camera's frame, live
// ones packed at the front so `count` is the number alive.
const C = LOOK.casings;
const casings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ specular: '#ffffff', shininess: 60 }), C.pool);
casings.name = 'casings';
casings.frustumCulled = false;
const brass = new THREE.Color(LOOK.colors.brass);
const shellRed = new THREE.Color(LOOK.colors.shell);
for (let i = 0; i < C.pool; i++) casings.setColorAt(i, brass); // makes instanceColor now, so the shader is compiled with it
casings.count = 0;
casings.visible = false;
viewCamera.add(casings);
const cases = Array.from({ length: C.pool }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, d: 0, l: 0, color: brass }));
const dummy = new THREE.Object3D();

function eject(weapon, port) {
  if (casings.count === C.pool) return;
  const c = cases[casings.count++];
  pose.updateMatrix();
  c.p.fromArray(port).applyMatrix4(pose.matrix);
  const r = () => 1 + (Math.random() - 0.5) * 2 * C.spread;
  c.v.set(C.velocity[0] * r(), C.velocity[1] * r(), C.velocity[2] * r());
  c.age = 0;
  [c.d, c.l] = C.size[weapon];
  c.color = weapon === 'shotgun' ? shellRed : brass;
}

function stepCasings(dt) {
  for (let i = 0; i < casings.count;) {
    const c = cases[i];
    c.age += dt;
    if (c.age >= C.life) { // swap-remove: the last live one takes this slot
      cases[i] = cases[casings.count - 1];
      cases[--casings.count] = c;
      continue;
    }
    c.v.y -= C.gravity * dt;
    c.p.addScaledVector(c.v, dt);
    dummy.position.copy(c.p);
    dummy.rotation.set(c.age * C.spin, c.age * C.spin * 0.4, 0);
    dummy.scale.set(c.d, c.d, c.l);
    dummy.updateMatrix();
    casings.setMatrixAt(i, dummy.matrix);
    casings.setColorAt(i, c.color);
    i++;
  }
  casings.instanceMatrix.needsUpdate = true;
  casings.instanceColor.needsUpdate = true;
  casings.visible = casings.count > 0;
}

// ---- Lights: the world's hemisphere and sun, copied every frame (so a
// retune of the world carries over), or set once by setLighting. A stand-in
// sky light until then.
const hemi = new THREE.HemisphereLight('#ffffff', '#555555', 2.5);
const sunLight = new THREE.DirectionalLight('#ffffff', 0);
viewScene.add(hemi, sunLight);
let srcHemi = null;
let srcSun = null;
let hemiBase = hemi.intensity;
const shade = spring(1);
const shadeGoal = new Float64Array(1);
const target = new THREE.Vector3();

// LIGHTS (bible §8.1): { sunColor, sunIntensity, sunDir, skyColor, groundColor, hemiIntensity }.
export function setLighting(L) {
  srcHemi = new THREE.HemisphereLight(L.skyColor, L.groundColor, L.hemiIntensity);
  srcSun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
  srcSun.position.fromArray(L.sunDir);
  srcSun.updateMatrixWorld();
}

// Mirror the world's lights once it has some.
function findLights(scene) {
  scene.traverse((o) => {
    if (o.isHemisphereLight) srcHemi ??= o;
    if (o.isDirectionalLight) srcSun ??= o;
  });
}

// Compile every viewmodel shader, hidden ones included, with the lights they
// will have, before the first shot needs them.
let warmed = false;
function prewarm(renderer) {
  warmed = true;
  const hidden = [];
  viewScene.traverse((o) => { if (!o.visible) hidden.push(o); o.visible = true; });
  renderer.compile(viewScene, viewCamera);
  for (const o of hidden) o.visible = false;
}

function syncLights(dt, boost) {
  springStep(shade, shadeGoal, LOOK.shadeHalflife, dt);
  if (srcHemi) {
    hemi.color.copy(srcHemi.color);
    hemi.groundColor.copy(srcHemi.groundColor);
    hemiBase = srcHemi.intensity;
  }
  hemi.intensity = hemiBase * (1 + boost);
  if (srcSun) {
    sunLight.color.copy(srcSun.color);
    sunLight.position.setFromMatrixPosition(srcSun.matrixWorld).sub(target.setFromMatrixPosition(srcSun.target.matrixWorld));
    sunLight.intensity = srcSun.intensity * (1 - shade.x[0] * (1 - LOOK.shadeSun));
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
  const d = sunLight.position;
  const len = d.length();
  if (!srcSun || !len) return false;
  toSun[0] = d.x / len;
  toSun[1] = d.y / len;
  toSun[2] = d.z / len;
  for (let i = 0; i < boxes.length; i++) if (rayBox(point, toSun, boxes[i].min, boxes[i].max) < Infinity) return true;
  return false;
}

// ---- ?debug&vm=<weapon>:<idle|recoil|reload|switch>:<0..1>[:shade]: a
// still pose for look-dev, the sun pinned on (or off with :shade).
const VM = (() => {
  const p = globalThis.location && new URLSearchParams(globalThis.location.search);
  if (!p?.has('debug') || !p.get('vm')) return null;
  const [weapon, at, t, sh] = p.get('vm').split(':');
  return { weapon: MODELS[weapon] ? weapon : 'rifle', pose: at, t: Math.min(1, Math.max(0, Number(t) || 0)), shade: sh === 'shade' };
})();
const vmState = { mover: { vx: 0, vy: 0, vz: 0, grounded: true, crouch: false }, arsenal: { slot: 0, reload: 0, cooldown: 0, switching: 0 } };

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
let landT = Infinity; // seconds since a landing,
let landDepth = 0; // and how deep it dips
let lastSlot = 0;
let lastSwitching = 0;
let switchT = Infinity; // seconds into a weapon switch
let castT = Infinity; // seconds into a power-up cast
let ejectAt = Infinity; // when the shotgun's pump throws its shell (ms)
let flashFrames = 0;
let glowUntil = -Infinity;
let pulseUntil = -Infinity;
const lag = spring();
const strafe = spring(1);
const kick = spring();
const action = spring();
const part = spring();
const left = spring();
const bobAmp = spring(1);
const goal = new Float64Array(6);
const partGoal = new Float64Array(6);
const leftGoal = new Float64Array(6);
const slideAt = new Float64Array(6);
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

// Our own slot colour on the armbands and the rifle's stripe.
export function setArmband(hex) {
  vmUniforms.vmSlot.value.set(hex);
}

// Using a power-up locks the gun briefly: a quick dip and roll instead of a
// switch. The arsenal's lock starts it too; a cast already running is kept.
export function powerCast() {
  if (castT >= LOOK.cast.seconds) castT = 0;
}

function show(weapon) {
  if (shown) rigs[shown].mesh.visible = false;
  shown = weapon;
  rigs[shown].mesh.visible = true;
  flashMesh.position.fromArray(MODELS[shown].muzzle);
}

function place(bone, pivot, x) {
  bone.position.set(pivot[0] + x[0], pivot[1] + x[1], pivot[2] + x[2]);
  bone.rotation.set(x[3], x[4], x[5]);
}
const ORIGIN = [0, 0, 0];

// Once per frame, after the world pass (it reads the world lights'
// matrices) and before the viewmodel's: the world camera and scene, to
// follow its turn and mirror its lights, and the renderer, to compile every
// viewmodel shader before the first shot needs it.
export function updateViewmodel(now, camera, scene, renderer) {
  const dt = lastNow === null ? 0 : Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  if (!srcHemi && !srcSun && scene) findLights(scene);
  if (!warmed && renderer && (srcHemi || srcSun)) prewarm(renderer);
  viewCamera.quaternion.copy(camera.quaternion);
  if (viewCamera.aspect !== camera.aspect) {
    viewCamera.aspect = camera.aspect;
    viewCamera.updateProjectionMatrix();
  }
  const { mover, arsenal } = VM ? vmState : self;
  const fired = shots > 0;
  shots = 0;
  if (!pose.visible || !mover || !arsenal) {
    flashMesh.visible = false;
    stepCasings(dt);
    syncLights(dt, 0);
    return;
  }
  if (VM) {
    wanted = VM.weapon;
    shadeGoal[0] = VM.shade ? 1 : 0;
    vmState.arsenal.reload = VM.pose === 'reload' ? (1 - VM.t) * WEAPONS[VM.weapon].reload : 0;
  }

  // A new slot lowers the old gun and raises the new one; the arsenal's
  // switching timer rising alone (a power-up's gun lock) casts instead.
  if (arsenal.slot !== lastSlot) {
    lastSlot = arsenal.slot;
    switchT = switchLow(switchT) * LOOK.switchPose.out; // a switch back starts from where the gun is
  } else if (arsenal.switching > lastSwitching + 0.05 && !raise) powerCast(); // a lock is 0.25 s or more; a correction's nudge is not
  lastSwitching = arsenal.switching;
  switchT += dt;
  castT += dt;
  if (raise) {
    raise = false;
    switchT = LOOK.switchPose.out; // come up from the bottom
    lastYaw = camera.rotation.y;
    lastPitch = camera.rotation.x;
    turnYaw = turnPitch = 0;
    wasGrounded = mover.grounded;
    landT = Infinity;
  }
  if (VM?.pose === 'switch') switchT = VM.t * SWITCH_SECONDS;
  if (shown !== wanted && (!shown || switchT >= LOOK.switchPose.out)) show(wanted);
  const m = MODELS[shown];
  const w = WEAPONS[shown];

  // Sway trails the turn, per pixel of mouse in a 60 Hz frame. A recoil kick
  // turns the camera too, but the gun leads that rather than trailing it, so
  // a frame with a shot keeps the last turn rate.
  const yaw = camera.rotation.y;
  const pitch = camera.rotation.x;
  const dy = yaw - lastYaw;
  const dp = pitch - lastPitch;
  lastYaw = yaw;
  lastPitch = pitch;
  if (dt > 0 && !fired && Math.abs(dy) < SNAP && Math.abs(dp) < SNAP) {
    turnYaw = dy / dt;
    turnPitch = dp / dt;
  }
  const sw = LOOK.sway;
  const px = sw.pxPerRad / 60; // px per frame for each rad/s of turn
  goal.fill(0);
  goal[0] = clamp(turnYaw * px * sw.posPerPx, sw.maxPos);
  goal[1] = clamp(-turnPitch * px * sw.posPerPx, sw.maxPos);
  goal[3] = clamp(-turnPitch * px * sw.rotPerPx, sw.maxRot);
  goal[4] = clamp(-turnYaw * px * sw.rotPerPx, sw.maxRot);
  springStep(lag, goal, sw.halflife, dt);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  one[0] = clamp((mover.vx * cos - mover.vz * sin) / RUN_SPEED, 1) * LOOK.strafeRoll;
  springStep(strafe, one, LOOK.strafeHalflife, dt);

  // Bob with ground speed, a figure-8 over two steps; breathe when still.
  const speed = Math.hypot(mover.vx, mover.vz);
  one[0] = mover.grounded ? Math.min(1, speed / RUN_SPEED) * (mover.crouch ? LOOK.bob.crouch : 1) : 0;
  springStep(bobAmp, one, LOOK.bob.halflife, dt);
  if (mover.grounded) bobPhase += (speed * dt * 2 * Math.PI) / LOOK.bob.cycle;
  const amp = bobAmp.x[0];
  const breath = Math.max(0, 1 - amp) * LOOK.idle * Math.sin((now / 1000) * 2 * Math.PI * LOOK.idleHz);

  // Landing: a dip that scales with the fall, down fast and back slower. The
  // step zeroes vy on touchdown, so the fall speed is the last one in the air.
  if (!mover.grounded) fallSpeed = -mover.vy;
  else if (!wasGrounded && fallSpeed > LOOK.land.minSpeed) {
    landT = 0;
    landDepth = Math.min(LOOK.land.max, LOOK.land.perSpeed * fallSpeed);
  }
  wasGrounded = mover.grounded;
  landT += dt;
  const L = LOOK.land;
  const land = landDepth * (landT < L.down ? ease(landT / L.down) : landT < L.down + L.back ? 1 - ease((landT - L.down) / L.back) : 0);

  // Recoil: each shot kicks back, up and a little roll either way.
  const k = m.kick;
  if (fired) {
    const r = Math.random() * 2 - 1;
    kick.v[2] += impulse(k.back, k.halflife);
    kick.v[3] += impulse(k.up, k.halflife);
    kick.v[5] += impulse(k.roll * r, k.halflife);
    if (m.eject) ejectAt = now + m.eject * 1000;
    else eject(shown, m.port);
  }
  springStep(kick, null, k.halflife, dt);
  if (VM?.pose === 'recoil') { // the kick as it stands that long after a shot
    const g = impulseShape(VM.t * 0.25, k.halflife);
    kick.x.set([0, 0, k.back * g, k.up * g, 0, k.roll * g]);
  }
  if (now >= ejectAt) {
    ejectAt = Infinity;
    eject(shown, m.port);
  }

  // Reload and pump poses straight from the arsenal's timers.
  goal.fill(0);
  partGoal.fill(0);
  leftGoal.fill(0);
  slideAt.fill(0);
  let shell = false;
  const tracks = shown !== wanted ? null : arsenal.reload > 0 ? m.reload : arsenal.cooldown > 0 ? m.cycle : null;
  if (tracks) {
    const t = tracks === m.reload ? 1 - arsenal.reload / w.reload : 1 / w.rps - arsenal.cooldown;
    sampleTrack(tracks.gun, t, goal);
    sampleTrack(tracks.part, t, partGoal);
    sampleTrack(tracks.left, t, leftGoal);
    sampleTrack(tracks.slide, t, slideAt);
    shell = tracks === m.reload && t < (m.shellUntil ?? 0);
  }
  springStep(action, goal, LOOK.actionHalflife, dt);
  springStep(part, partGoal, LOOK.actionHalflife, dt);
  springStep(left, leftGoal, LOOK.actionHalflife, dt);

  const low = switchLow(switchT);
  const cast = castT < LOOK.cast.seconds ? Math.sin((Math.PI * castT) / LOOK.cast.seconds) : 0;
  const c = Math.sin(bobPhase);
  for (let i = 0; i < 6; i++) sum[i] = m.base[i] + lag.x[i] + kick.x[i] + action.x[i];
  sum[0] += c * LOOK.bob.side * amp;
  sum[1] += Math.sin(2 * bobPhase) * LOOK.bob.dip * amp + breath - land + low * LOOK.switchPose.y - cast * LOOK.cast.dip;
  sum[3] += low * LOOK.switchPose.pitch - land * L.pitch;
  sum[5] += strafe.x[0] + cast * LOOK.cast.roll;
  pose.position.set(sum[0], sum[1], sum[2]);
  pose.rotation.set(sum[3], sum[4], sum[5]);
  const { bones } = rigs[shown];
  place(bones.part, m.pivots.part, part.x);
  place(bones.left, m.pivots.left, left.x);
  place(bones.slide, ORIGIN, slideAt);
  bones.shell.scale.setScalar(shell ? 1 : 0);

  // The star shows for two frames, the glow, the barrel's heat and the
  // brighter sky light for their times but at least one frame.
  if (fired) {
    flashFrames = LOOK.flash.frames;
    glowUntil = now + LOOK.flash.glowSeconds * 1000;
    pulseUntil = now + LOOK.flash.pulseSeconds * 1000;
    flashMesh.rotation.z = Math.random() * 2 * Math.PI;
    flashUniforms.starSize.value = m.flash * (1 + (Math.random() - 0.5) * LOOK.flash.jitter);
  }
  const star = flashFrames > 0 || (VM?.pose === 'recoil' && VM.t <= 0.2);
  if (flashFrames > 0) flashFrames--;
  if (VM?.pose === 'recoil') flashUniforms.starSize.value = m.flash;
  const glow = fired || now < glowUntil || star;
  const hotNow = fired || now < pulseUntil || star;
  flashUniforms.star.value = star ? 1 : 0;
  flashUniforms.glow.value = glow ? 1 : 0;
  flashMesh.visible = star || glow;
  vmUniforms.vmPulse.value.setRGB(0, 0, 0);
  if (hotNow) vmUniforms.vmPulse.value.copy(pulse);
  stepCasings(dt);
  syncLights(dt, hotNow ? LOOK.flash.hemiBoost : 0);
}

// Where the muzzle shows on screen, as the point as far along the world
// camera's ray through that pixel, so world effects such as tracers can
// start at the gun. Valid after a frame has been drawn.
const muzzle = new THREE.Vector3();
export function muzzleWorld(camera, out = new THREE.Vector3()) {
  flashMesh.getWorldPosition(muzzle);
  const dist = muzzle.length();
  muzzle.project(viewCamera);
  return out.set(muzzle.x, muzzle.y, 0.5).unproject(camera).sub(camera.position).setLength(dist).add(camera.position);
}
