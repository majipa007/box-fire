// First-person arms and gun (bible §3.2). Each weapon is a few dozen boxes
// from the data below, merged into one skinned, vertex-coloured mesh: one
// draw for the gun and both arms, with bones for what moves on its own (the
// magazine or pump, the left hand, the pistol's slide, what the hand brings
// in, and the two forearms, which bend at the wrist).
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
  // Surface. Blinn-Phong strength and shininess of the sun's highlight per
  // colour key: cloth broad and faint, so a flat face shades across rather
  // than flashing all at once as the sun turns behind us; metal tighter and
  // stronger. Edges glint twice as bright on keys from edgeGlint gloss up.
  shine: { metal: 0.6, dark: 0.12, tan: 0.1, kit: 0.015, glove: 0.05, shell: 0.3, brass: 0.9, slot: 0.03 },
  gloss: { metal: 36, dark: 24, tan: 14, kit: 10, glove: 12, shell: 24, brass: 40, slot: 10 },
  edgeGlint: 24,
  bevel: 0.004, // m: the band along every box edge that catches the light,
  bevelLift: 2, // where the albedo becomes albedo × (1 + lift) + add,
  bevelAdd: 0.06, // and the highlight doubles;
  bevelCatch: 0.1, // share of that kept on an edge facing down; one facing up catches the sky in full
  groove: [0.008, 0.0095, 0.55, 0.045], // and a panel line this far in (from, to), darkened to this share, on faces wider than the last
  // The sky light's colours reflected off each face (ground below, sky above),
  // × shine and a Schlick fresnel: metal reads as metal, and every part
  // keeps a rim where it turns away from us.
  env: 0.28, // reflection gain at full shine
  envFloor: 0.3, // share of it facing us; the rest comes in at grazing angles
  rim: 0.06, // fresnel rim on every surface, shine or not,
  sheen: { kit: 0.35, glove: 0.3 }, // and stronger on cloth: dark sleeves and gloves read by their edges
  grain: 0.08, // ± share of the albedo per grain voxel: pixel-art texture with no texture,
  grainAbs: 0.008, // plus ± this much linear albedo, so near-black keys show it too
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
    core: '#ffd27a', edge: '#ff8a3d', frames: 2, // star: crossed additive quads at a random roll
    tongue: [0.6, 1.4], points: 6, rays: 6, coreGain: 1.6, // quads along the barrel, × the flash size; the star mask
    glow: 0.5, glowColor: '#ff9a4a', glowAlpha: 0.45, glowSeconds: 0.05,
    pulse: '#ff9a4a', pulseGain: 0.6, pulseSeconds: 0.04, // emissive on the barrel boxes
    hemiBoost: 0.3, // the view's sky light rises this share while the barrel glows
  },
  casings: {
    pool: 16, velocity: [2, 1.6, 0.3], spread: 0.15, spin: 15, life: 0.45, gravity: 9.8,
  },
};

// ---- Model data. Each gun's boxes live in its own gun file's `look`
// (shared/guns/*.js): colour keys, sizes, centres, optional rotations and
// bone tags, plus its muzzle, ejection port, support-hand point (`fore`) and
// the pivot of its moving child (`mag`). Here they become boxes on the
// viewmodel's bones, joined by the arms and a copy of the magazine for the
// left hand, and a style per gun class adds the rest pose, recoil and reload.
// A box is a bone ('body' moves with the gun, 'part' is the magazine, pump or
// cylinder, 'left' the left arm, 'slide' the slide, bolt or feed cover,
// 'shell' what the left hand brings in), a colour key, a size and a centre,
// with an optional rotation; a limb is a box of cross-section [w, h]
// stretched between two points; hot boxes glow when the gun fires. Gun space
// has its origin at the right hand on the grip, and the rest pose puts that
// point where the bible's table puts the gun: `rest` places `anchor` (about
// the receiver's centre) in camera space.
const box = (part, color, size, at, rot) => ({ part, color, size, at, rot });
const limb = (part, color, size, from, to) => ({ part, color, size, from, to });
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const toward = (a, b, d) => a.map((v, i) => v + ((b[i] - v) * d) / Math.hypot(...b.map((w, j) => w - a[j])));
// A copy of the magazine in the left hand: where the magazine would be with
// the left bone moved back by `seat`, so at the seat the two coincide.
const inHand = (mag, seat) => mag.map((b) => ({ ...b, part: 'shell', at: add(b.at, seat.map((v) => -v)) }));
const BONE_OF = { mag: 'part', pump: 'part', slide: 'slide', bolt: 'slide', cover: 'slide' };
const gunBoxes = (look) => look.parts.map((p) => ({ part: BONE_OF[p.bone] ?? 'body', color: p.c, size: p.s, at: p.at, rot: p.r, hot: p.hot }));
// Where the left hand's pivot goes to seat a magazine: under the well.
const HAND_UNDER = [0.005, -0.125, 0];
const ORIGIN = [0, 0, 0];

// The armband at the wrist, in the slot colour, and the forearm toward the
// elbow, on a forearm bone ('rfore' or 'lfore') that keeps aiming at where
// the elbow rests however the hand moves: a wrist, so a raised or tilted gun
// or a busy left hand never swings a whole sleeve across the screen.
const sleeve = (part, wrist, elbow) => {
  const band = toward(wrist, elbow, 0.04);
  return [Object.assign(limb(part, 'slot', [0.12, 0.12], wrist, band), { elbow }), limb(part, 'kit', [0.115, 0.115], band, toward(band, elbow, 0.32))];
};

// The right hand round the grip; armband and forearm run off toward an
// elbow below the screen. 1.15 × the third-person arm.
function rightArm(elbow, wrist = [0.012, -0.04, 0.055]) {
  return [
    box('body', 'glove', [0.105, 0.105, 0.115], [0.006, -0.014, 0.006]), // fist
    box('body', 'glove', [0.028, 0.03, 0.075], [-0.05, 0.042, -0.03]), // thumb along the receiver
    box('body', 'glove', [0.02, 0.02, 0.05], [-0.024, 0.012, -0.068]), // trigger finger
    ...[0, 1, 2].map((k) => box('body', 'glove', [0.022, 0.024, 0.07], [-0.047, -0.002 - k * 0.027, -0.014 - k * 0.004])), // fingers round the grip
    ...sleeve('rfore', wrist, elbow),
  ];
}

// The left hand under a handguard or pump whose centre line is at `at`; the
// upper arm carries the sleeve off the bottom of the screen.
function leftArm(at, elbow) {
  const wrist = add(at, [-0.03, -0.085, 0.06]);
  const fore = toward(wrist, elbow, 0.36);
  return [
    box('left', 'glove', [0.105, 0.105, 0.115], add(at, [-0.016, -0.062, 0.004])), // palm and fingers under
    box('left', 'glove', [0.026, 0.026, 0.07], add(at, [-0.04, 0.012, -0.016])), // thumb along the near side
    ...sleeve('lfore', wrist, elbow),
    limb('lfore', 'kit', [0.125, 0.125], fore, toward(fore, elbow, 0.3)),
  ];
}

// Long guns: the right hand on the grip, the left under the look's `fore`.
const longArms = (look) => [...rightArm([0.17, -0.32, 0.34]), ...leftArm(look.fore, [-0.24, -0.3, -0.06])];
// Handguns: a high grip, both wrists in line with the slide, so the armbands
// and forearms come in from the bottom edge rather than below it; the
// support hand wraps the right fist.
const HANDGUN_LEFT = [-0.04, -0.01, -0.01];
const handgunArms = () => [
  ...rightArm([0.3, -0.28, 0.3], [0.02, 0, 0.07]),
  box('left', 'glove', [0.105, 0.09, 0.1], [-0.052, -0.026, -0.004]),
  box('left', 'glove', [0.06, 0.045, 0.03], [-0.012, -0.03, -0.058]),
  box('left', 'glove', [0.024, 0.024, 0.06], [-0.036, 0.04, -0.04]),
  ...[0, 1, 2].map((k) => box('left', 'glove', [0.018, 0.024, 0.07], [-0.106, 0.008 - k * 0.027, -0.012 - k * 0.004])), // fingers
  ...sleeve('lfore', [-0.085, -0.005, 0.05], [-0.34, -0.28, 0.28]),
];

// Reloads. A track is [t, x, y, z, pitch, yaw, roll] keys (missing values
// are 0), eased between keys and held past the ends; `reload` runs over the
// reload timer as a fraction (per shell for the shotgun), `cycle` over the
// seconds since a shot.
// A long gun's magazine: tilt over 0–0.14 so the well shows; the magazine
// drops out in view and leaves at the lower left by 0.27 while the hand
// fetches a new one off screen; the hand brings it up in view from 0.33 and
// seats it at 0.6 (the click); a slap at `slap` (the left hand's pivot
// offset) at 0.76. `extra` adds tracks (a bolt, a feed cover).
// `lift` brings a long magazine up higher; `drop` scales its first fall, for
// a magazine near the camera; `approach` is where the hand is, from the
// seat, at 0.34 and 0.5, for a well the right fist would hide.
const APPROACH = [[0.075, -0.08, 0], [0.025, -0.03, 0]];
// From ahead and to the left, the open side, for a well close to the grip:
// from the usual side the right fist stands between the eye and the magazine.
const OPEN_SIDE = [[-0.06, -0.08, -0.1], [-0.03, -0.03, -0.05]];
function magReload(seat, tilt, slap, { lift = 0, drop = 1, approach = APPROACH, ...extra } = {}) {
  const at = (d, ...rot) => [...add(seat, d), ...rot];
  const near = approach.map((d) => add(d, [0, lift, 0]));
  return {
    gun: [[0], [0.14, ...tilt], [0.72, ...tilt], [0.76, ...add(tilt, [0, -0.008, 0.016, 0.05, 0, 3 * DEG])], [0.8, ...tilt], [0.94]],
    part: [[0.14], [0.2, 0.02 * drop, -0.15 * drop, 0.01, 0.3 * drop, 0, 0.2 * drop], [0.27, 0.1, -0.8, 0.03, 0.8, 0, 0.5], [0.6]],
    left: [[0.1], [0.18, ...at([-0.005, -0.13, -0.06], 0.2)], [0.27, ...at([0.095, -0.63, -0.01], 0.3)], [0.34, ...at(near[0])], [0.5, ...at(near[1])],
      [0.6, ...seat], [0.64, ...seat], [0.71, ...slap], [0.76, ...add(slap, [0.005, 0.01, -0.02])], [0.88]],
    hold: [0.28, 0.6], // the new magazine is in the hand, the old one gone
    ...extra,
  };
}
// A handgun's magazine, the long gun's fractions with the gun on its side so
// the grip opens toward the support hand, clear of the HUD; the slide drops
// home at 0.76 while the support hand waits under the grip.
// `approach` is where the support hand is, from the seat, at 0.33 and 0.5;
// `drop` sends a long magazine further down out of sight.
const HANDGUN_APPROACH = [[0.01, -0.1, 0], [0, -0.05, 0]];
const handgunReload = (seat, tilt, { approach = HANDGUN_APPROACH, drop = 0.7 } = {}) => ({
  gun: [[0], [0.14, ...tilt], [0.8, ...tilt], [0.94]],
  part: [[0.14], [0.2, 0, -0.12, 0.01, 0.3], [0.27, 0, -drop, 0.02, 0.6], [0.6]],
  left: [[0.1], [0.18, 0, -0.25, 0.05, 0.1], [0.26, 0, seat[1] - drop + 0.2, 0.05], [0.33, ...add(seat, approach[0])], [0.5, ...add(seat, approach[1])], [0.6, ...seat], [0.8, ...seat], [0.94]],
  hold: [0.28, 0.6],
  slide: [[0.72], [0.76, 0, 0, 0.03], [0.78]],
});

// The Sledge: the gun rolls onto its side (left side up) so the cylinder,
// swung out on its crane by 0.14, faces us; the muzzle tips up at 0.2 to dump
// the cases; the left hand comes back from below with a speedloader, seats it
// at 0.56 and lets go at 0.64; the wrist flicks the cylinder shut at 0.77.
const REVOLVER_TILT = [-0.02, 0.1, 0, 0.35, 0.7, -0.4];
const CYLINDER_OUT = [-0.012, -0.005, 0, 0, 0, 1.45];
// The speedloader in gun space where it seats, behind the swung-out
// cylinder, and where the left hand's pivot is then (its fingers on the knob).
const SPEEDLOADER = [
  box('shell', 'brass', [0.04, 0.04, 0.02], [-0.054, 0.061, 0.024]), // six rounds
  box('shell', 'dark', [0.046, 0.046, 0.006], [-0.054, 0.061, 0.037]), // plate
  box('shell', 'metal', [0.018, 0.018, 0.03], [-0.054, 0.061, 0.055]), // knob
];
const LOADER_SEAT = [-0.01, 0.06, 0.13];
const revolverReload = {
  gun: [[0], [0.12, ...REVOLVER_TILT], [0.2, ...add(REVOLVER_TILT, [0, 0.04, 0, 0.7, 0, 0])], [0.3, ...REVOLVER_TILT], [0.7, ...REVOLVER_TILT],
    [0.76, ...add(REVOLVER_TILT, [0, 0, 0, 0, 0, 0.45])], [0.8, ...REVOLVER_TILT], [0.94]],
  part: [[0.06], [0.14, ...CYLINDER_OUT], [0.72, ...CYLINDER_OUT], [0.77]],
  left: [[0.08], [0.16, -0.02, -0.12, 0.04, 0.2], [0.24, -0.06, -0.6, 0.05], [0.34, ...add(LOADER_SEAT, [-0.04, -0.12, 0.06])], [0.48, ...add(LOADER_SEAT, [0, 0, 0.04])],
    [0.56, ...LOADER_SEAT], [0.64, ...LOADER_SEAT], [0.7, ...add(LOADER_SEAT, [-0.04, -0.06, 0.04])], [0.86]],
  hold: [0.26, 0.64],
};
// A turn-bolt: the handle rolls up a turn about the bore, then the bolt runs back.
const BOLT_UP = [0, 0, 0, 0, 0, 1];
const BOLT_BACK = [0, 0, 0.085, 0, 0, 1];

// Per gun class: rest pose and anchor; flash size; recoil, as the peak
// offsets one shot reaches before its spring brings it back (back in metres,
// up and roll in radians, the roll random either way); casings (diameter,
// length, colour key; `eject` delays them to a pump or bolt); arms; and the
// reload and cycle tracks, from the gun's magazine seat when it has one.
const RIFLE_TILT = [0.03, 0.09, 0.04, 0.2, 0.1, -25 * DEG]; // raised, turned and tilted 25° so the magazine well shows; the gun stays 57 px clear of the crosshair at 720p
const PISTOL_TILT = [0.08, 0.12, -0.06, 0.15, 0.2, -1.1]; // on its side, so the grip opens toward the support hand, clear of the HUD
const BULLPUP_TILT = [0.0, 0.16, 0.0, -0.3, 0.35, -35 * DEG]; // raised high and turned in, the well behind the grip toward the middle
const STYLE = {
  rifle: {
    rest: [0.2, -0.19, -0.6, 0.03, 0.08, 0], anchor: [0, 0.075, -0.07], flash: 0.18,
    kick: { back: 0.035, up: 2.5 * DEG, roll: 1.5 * DEG, halflife: 0.045 }, casing: [0.012, 0.035, 'brass'],
    arms: longArms,
    // Bolt slap at 0.76 by the left side of the receiver.
    reload: (seat) => magReload(seat, RIFLE_TILT, [-0.045, -0.02, 0.27]),
  },
  smg: { // light and quick: a small kick, a fast spring
    rest: [0.19, -0.18, -0.55, 0.03, 0.08, 0], anchor: [0, 0.075, -0.07], flash: 0.14,
    kick: { back: 0.022, up: 1.4 * DEG, roll: 1.2 * DEG, halflife: 0.035 }, casing: [0.01, 0.022, 'brass'],
    arms: longArms,
    reload: (seat) => magReload(seat, add(RIFLE_TILT, [0, 0.04, 0, 0, 0, 0]), [-0.04, 0, 0.1], { lift: 0.07, drop: 0.75, approach: OPEN_SIDE }), // slaps the charging knob
  },
  burst: { // the bullpup's well is behind the grip, so the left hand reaches back for it
    rest: [0.2, -0.19, -0.58, 0.03, 0.08, 0], anchor: [0, 0.08, 0.1], flash: 0.16,
    kick: { back: 0.03, up: 2 * DEG, roll: 1 * DEG, halflife: 0.04 }, casing: [0.012, 0.035, 'brass'],
    arms: longArms,
    reload: (seat) => magReload(seat, BULLPUP_TILT, [-0.05, 0, 0.2], { lift: 0.1, drop: 0.8, approach: OPEN_SIDE }),
  },
  marksman: { // heavy single shots: a deep, slower kick
    rest: [0.2, -0.19, -0.6, 0.03, 0.08, 0], anchor: [0, 0.09, -0.06], flash: 0.2,
    kick: { back: 0.06, up: 4.5 * DEG, roll: 1 * DEG, halflife: 0.07 }, casing: [0.014, 0.045, 'brass'],
    arms: longArms,
    reload: (seat) => magReload(seat, RIFLE_TILT, [-0.045, 0, 0.22], { approach: OPEN_SIDE }),
  },
  pistol: {
    rest: [0.17, -0.17, -0.5, 0, 0.1, 0], anchor: [0, 0.06, -0.055], flash: 0.12,
    kick: { back: 0.05, up: 4 * DEG, roll: 1.5 * DEG, halflife: 0.06 }, casing: [0.01, 0.022, 'brass'],
    left: HANDGUN_LEFT, seat: [0.05, -0.1, 0.03], // the support hand under the grip
    arms: handgunArms,
    reload: (seat) => handgunReload(seat, PISTOL_TILT),
    cycle: { slide: [[0, 0, 0, 0.03], [0.06]] }, // slide recoils 0.03 m
  },
  machinepistol: { // a handgun that sprays: a light, quick kick and the pistol's reload, the long magazine through the grip
    rest: [0.17, -0.17, -0.5, 0, 0.1, 0], anchor: [0, 0.07, -0.06], flash: 0.12,
    kick: { back: 0.025, up: 1.6 * DEG, roll: 1.5 * DEG, halflife: 0.035 }, casing: [0.01, 0.022, 'brass'],
    left: HANDGUN_LEFT, seat: [0.05, -0.17, 0.03], // the support hand under the long magazine's base plate, so the magazine stands up out of the fist
    arms: handgunArms,
    reload: (seat) => handgunReload(seat, [0.12, 0.18, -0.06, 0.35, 0.2, -1.1], { drop: 0.94, approach: [[0.01, -0.08, 0], [0, -0.04, 0]] }), // the pistol's roll, raised so the long magazine has room below; it comes up close under the grip
  },
  handcannon: { // a revolver: a big slow kick, no casings at the shot
    rest: [0.17, -0.17, -0.5, 0, 0.1, 0], anchor: [0, 0.065, -0.06], flash: 0.2,
    kick: { back: 0.07, up: 9 * DEG, roll: 2 * DEG, halflife: 0.08 }, casing: null,
    left: HANDGUN_LEFT, seat: null, // the cylinder stays on the gun: only the speedloader is in the hand
    arms: handgunArms,
    held: () => SPEEDLOADER.map((b) => ({ ...b, at: sub(b.at, LOADER_SEAT) })),
    reload: () => revolverReload,
  },
  lmg: { // heavy: a small kick on a slow spring; the feed cover opens for the box
    rest: [0.2, -0.2, -0.6, 0.03, 0.08, 0], anchor: [0, 0.075, -0.07], flash: 0.2,
    kick: { back: 0.03, up: 1.8 * DEG, roll: 1.2 * DEG, halflife: 0.05 }, casing: [0.012, 0.035, 'brass'],
    arms: longArms,
    // The cover lifts at 0.04–0.12 and the left hand slaps it shut at 0.71.
    reload: (seat) => magReload(seat, RIFLE_TILT, [0.016, 0.2, 0.256], { lift: 0.08, drop: 0.8,  slide: [[0.04], [0.12, 0, 0, 0, -1.1], [0.66, 0, 0, 0, -1.1], [0.72]] }),
  },
  sniper: { // one heavy shot, then the bolt: up, back (the case flies), forward, down
    rest: [0.2, -0.19, -0.62, 0.03, 0.08, 0], anchor: [0, 0.08, -0.06], flash: 0.3,
    kick: { back: 0.09, up: 8 * DEG, roll: 1.5 * DEG, halflife: 0.1 }, casing: [0.014, 0.05, 'brass'],
    eject: 0.32,
    arms: longArms,
    // The bolt opens at 0.02–0.12 and the left hand runs it home at 0.74–0.79.
    reload: (seat) => magReload(seat, [0.04, 0.05, 0.04, 0.12, 0, -25 * DEG], [0.06, 0.07, 0.38], { // tilted but not turned in: the long barrel would cross the crosshair
      approach: OPEN_SIDE,
      slide: [[0.02], [0.07, ...BOLT_UP], [0.12, ...BOLT_BACK], [0.74, ...BOLT_BACK], [0.79, ...BOLT_UP], [0.83]] }),
    cycle: {
      slide: [[0.08], [0.16, ...BOLT_UP], [0.3, ...BOLT_BACK], [0.38, ...BOLT_BACK], [0.48, ...BOLT_UP], [0.56]],
      gun: [[0.08], [0.2, 0, -0.005, 0, 0, 0, 0.06], [0.48, 0, -0.005, 0.01, 0, 0, 0.06], [0.62]],
    },
  },
  shotgun: {
    rest: [0.2, -0.2, -0.58, 0.03, 0.08, 0], anchor: [0, 0.07, -0.08], flash: 0.28,
    kick: { back: 0.09, up: 7 * DEG, roll: 1.5 * DEG, halflife: 0.09 }, casing: [0.024, 0.06, 'shell'],
    eject: 0.43, // seconds after a shot: the pump is back and the shell flies
    seat: null, // no magazine to swap: shells go in one at a time
    arms: longArms,
    held: () => [box('shell', 'shell', [0.024, 0.024, 0.06], [-0.08, 0.03, -0.37])], // the shell being loaded, in the left hand's fingertips
    // One shell per 0.5 s: tilted 10°, hand to the port 0–0.25 s, insert 0.25–0.40 s, back 0.40–0.50 s.
    reload: () => ({
      gun: [[0, 0.03, 0.06, 0, 0.1, 0.05, -10 * DEG]],
      left: [[0, 0, -0.14, 0.2], [0.5, 0, -0.075, 0.27], [0.8, 0, -0.045, 0.26], [1, 0, -0.14, 0.2]],
      hold: [0, 0.8], // the shell shows in the hand until it is pushed in
    }),
    // Racks 0.07 m from 300 to 560 ms after each shot.
    cycle: {
      gun: [[0.28], [0.43, 0, 0.005, 0, 0.04, 0, -0.05], [0.6]],
      part: [[0.3], [0.43, 0, 0, 0.07], [0.56]],
      left: [[0.3], [0.43, 0, 0, 0.07], [0.56]],
    },
  },
};

function model(look, s) {
  const gun = gunBoxes(look);
  const seat = s.seat !== undefined ? s.seat : add(sub(look.mag, look.fore), HAND_UNDER);
  return {
    rest: s.rest, anchor: s.anchor, muzzle: look.muzzle, flash: s.flash, port: look.port, kick: s.kick, eject: s.eject, casing: s.casing,
    pivots: { part: look.mag ?? ORIGIN, left: look.fore ?? s.left, slide: look.action ?? ORIGIN },
    boxes: [...gun, ...(s.held ? s.held(look, seat) : inHand(gun.filter((b) => b.part === 'part'), seat)), ...s.arms(look)],
    seat: seat ?? undefined, reload: s.reload(seat), cycle: s.cycle,
  };
}
export const MODELS = Object.fromEntries(Object.keys(WEAPONS).filter((id) => STYLE[WEAPONS[id].class] && WEAPONS[id].look).map((id) => [id, model(WEAPONS[id].look, STYLE[WEAPONS[id].class])]));

// Each gun's overall size [width, height, length] from its look (rotations ignored).
export const GUN_SHAPES = Object.fromEntries(Object.keys(MODELS).map((id) => {
  const ps = WEAPONS[id].look.parts;
  return [id, [0, 1, 2].map((k) => Math.max(...ps.map((p) => p.at[k] + p.s[k] / 2)) - Math.min(...ps.map((p) => p.at[k] - p.s[k] / 2)))];
}));

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
// edges, a grain, an unlit lift, the slot colour, the barrel's glow and a
// shininess per colour key, patched into three's shader.
const f = (x) => x.toFixed(5);
const vmUniforms = {
  vmSlot: { value: new THREE.Color('#ffffff') }, vmPulse: { value: new THREE.Color(0, 0, 0) },
};
const material = new THREE.MeshPhongMaterial({ vertexColors: true, specular: '#ffffff' });
material.onBeforeCompile = (s) => {
  Object.assign(s.uniforms, vmUniforms);
  const decl = 'varying vec4 vEdge;\nvarying vec4 vMat;\nvarying vec3 vGrain;\nvarying float vGloss;\nvarying vec4 vEdgeUp;\n';
  s.vertexShader = s.vertexShader
    .replace('#include <common>', `#include <common>\nattribute vec4 edge;\nattribute vec4 mat;\nattribute float gloss;\nattribute vec4 edgeUp;\n${decl}`)
    .replace('#include <color_vertex>', `#include <color_vertex>
      vEdge = edge;
      vMat = mat;
      vGloss = gloss;
      vEdgeUp = edgeUp;
      vGrain = ( position - normal * 0.001 ) / ${f(LOOK.grainSize)};`);
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec3 vmSlot;\nuniform vec3 vmPulse;\n${decl}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix( vec3( 1.0 ), vmSlot, vMat.z );
      float vmN = fract( sin( dot( floor( vGrain ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) - 0.5;
      diffuseColor.rgb = max( vec3( 0.0 ), diffuseColor.rgb * ( 1.0 + ${f(2 * LOOK.grain)} * vmN ) + ${f(2 * LOOK.grainAbs)} * vmN );
      float vmU = min( vEdge.x, vEdge.z - vEdge.x );
      float vmW = min( vEdge.y, vEdge.w - vEdge.y );
      float vmEdge = min( vmU, vmW );
      float vmBevel = 1.0 - smoothstep( ${f(LOOK.bevel * 0.5)}, ${f(LOOK.bevel)}, vmEdge );
      float vmEdgeUp = vmU < vmW ? ( vEdge.x < vEdge.z - vEdge.x ? vEdgeUp.x : vEdgeUp.y ) : ( vEdge.y < vEdge.w - vEdge.y ? vEdgeUp.z : vEdgeUp.w );
      vmBevel *= mix( ${f(LOOK.bevelCatch)}, 1.0, saturate( vmEdgeUp * 0.7 + 0.5 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ${f(1 + LOOK.bevelLift)} + ${f(LOOK.bevelAdd)}, vmBevel );
      if ( min( vEdge.z, vEdge.w ) > ${f(LOOK.groove[3])} && vmEdge > ${f(LOOK.groove[0])} && vmEdge < ${f(LOOK.groove[1])} ) diffuseColor.rgb *= ${f(LOOK.groove[2])};`)
    .replace('#include <specularmap_fragment>', `float specularStrength = vMat.x * ( 1.0 + vmBevel * step( ${f(LOOK.edgeGlint)}, vGloss ) );`)
    .replace('#include <lights_phong_fragment>', '#include <lights_phong_fragment>\nmaterial.specularShininess = vGloss;')
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

const BONES = ['body', 'part', 'left', 'slide', 'shell', 'rfore', 'lfore'];
const Z = new THREE.Vector3(0, 0, 1);

// One box: its colour (lower half shaded), the face-local edge distances
// (u·w, v·h, w, h) the bevel needs, its surface (shine, hot, slot, rim) and its bone.
function boxGeometry(b) {
  const dir = b.from && new THREE.Vector3(...b.to).sub(new THREE.Vector3(...b.from));
  const [w, h, d] = [b.size[0], b.size[1], dir ? dir.length() : b.size[2]];
  const g = new THREE.BoxGeometry(w, h, d);
  const turn = dir ? new THREE.Quaternion().setFromUnitVectors(Z, dir.clone().normalize()) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(b.rot ?? [0, 0, 0])));
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // BoxGeometry's px, nx, py, ny, pz, nz
  const c = new THREE.Color(LOOK.colors[b.color]); // sRGB hex to linear
  const n = g.attributes.position.count;
  const color = new Float32Array(n * 3);
  const edge = new Float32Array(n * 4);
  const mat = new Float32Array(n * 4);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const up = new Float32Array(n * 4);
  const tu = new THREE.Vector3();
  const tv = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (i % 4 === 0) { // a face's vertices run (u, v) = (0, 1), (1, 1), (0, 0), (1, 0)
      p0.fromBufferAttribute(pos, i);
      tu.fromBufferAttribute(pos, i + 1).sub(p0).normalize().applyQuaternion(turn);
      tv.copy(p0).sub(p0.clone().fromBufferAttribute(pos, i + 2)).normalize().applyQuaternion(turn);
    }
    // How far up each edge's bevel faces, between this face and the one past
    // that edge: top edges catch the sky, bottom ones stay dark.
    const ny = p0.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyQuaternion(turn).y;
    up.set([ny - tu.y, ny + tu.y, ny - tv.y, ny + tv.y].map((v) => v * Math.SQRT1_2), i * 4);
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
  g.setAttribute('gloss', new THREE.BufferAttribute(new Float32Array(n).fill(LOOK.gloss[b.color]), 1));
  g.setAttribute('edgeUp', new THREE.BufferAttribute(up, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  if (dir) return g.translate(0, 0, d / 2).applyQuaternion(turn).translate(...b.from);
  return g.applyQuaternion(turn).translate(...b.at);
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
  bones.body.add(bones.part, bones.left, bones.slide, bones.rfore);
  bones.left.add(bones.shell, bones.lfore);
  bones.part.position.fromArray(m.pivots.part);
  bones.left.position.fromArray(m.pivots.left);
  bones.slide.position.fromArray(m.pivots.slide);
  // Each forearm turns about its wrist; where its elbow rests, in camera space.
  const restPose = new THREE.Matrix4().compose(new THREE.Vector3(...m.base), new THREE.Quaternion().setFromEuler(new THREE.Euler(...m.base.slice(3))), new THREE.Vector3(1, 1, 1));
  m.arms = ['rfore', 'lfore'].map((name) => {
    const band = m.boxes.find((b) => b.part === name && b.elbow);
    bones[name].position.fromArray(band.from);
    if (name === 'lfore') bones[name].position.sub(bones.left.position);
    const dir = new THREE.Vector3(...band.elbow).sub(new THREE.Vector3(...band.from)).normalize();
    return { bone: bones[name], dir, elbow: new THREE.Vector3(...band.elbow).applyMatrix4(restPose) };
  });
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

// ---- Our own casings: a pooled instanced box in the view scene, which
// turns with the world, so a flick leaves them behind and they fall down,
// not toward the bottom of the screen. Live ones are packed at the front so
// `count` is the number alive.
const C = LOOK.casings;
const casings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ specular: '#ffffff', shininess: 60 }), C.pool);
casings.name = 'casings';
casings.frustumCulled = false;
const brass = new THREE.Color(LOOK.colors.brass);
const shellRed = new THREE.Color(LOOK.colors.shell);
for (let i = 0; i < C.pool; i++) casings.setColorAt(i, brass); // makes instanceColor now, so the shader is compiled with it
casings.count = 0;
casings.visible = false;
viewScene.add(casings);
const cases = Array.from({ length: C.pool }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, d: 0, l: 0, color: brass }));
const dummy = new THREE.Object3D();

function eject(m) {
  if (!m.casing || casings.count === C.pool) return;
  const c = cases[casings.count++];
  pose.updateMatrix();
  c.p.fromArray(m.port).applyMatrix4(pose.matrix).applyQuaternion(viewCamera.quaternion);
  const r = () => 1 + (Math.random() - 0.5) * 2 * C.spread;
  c.v.set(C.velocity[0] * r(), C.velocity[1] * r(), C.velocity[2] * r()).applyQuaternion(viewCamera.quaternion);
  c.age = 0;
  [c.d, c.l] = m.casing;
  c.color = m.casing[2] === 'shell' ? shellRed : brass;
  casings.visible = true;
}

function stepCasings(dt) {
  if (!casings.visible) return;
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
  ejectAt = Infinity; // a pending shell belongs to the gun going away
  if (shown) rigs[shown].mesh.visible = false;
  shown = weapon;
  rigs[shown].mesh.visible = true;
  flashMesh.position.fromArray(MODELS[shown].muzzle);
  flashUniforms.starSize.value = MODELS[shown].flash;
}

function place(bone, pivot, x) {
  bone.position.set(pivot[0] + x[0], pivot[1] + x[1], pivot[2] + x[2]);
  bone.rotation.set(x[3], x[4], x[5]);
}

// Turn each forearm about its wrist toward its resting elbow. Camera space:
// the pose's parent.
const wrist = new THREE.Vector3();
const aim = new THREE.Vector3();
const toParent = new THREE.Quaternion();
const toCamera = new THREE.Matrix4();
function aimForearms(arms) {
  pose.updateMatrix();
  for (let i = 0; i < arms.length; i++) {
    const { bone, dir, elbow } = arms[i];
    const parent = bone.parent; // body (fixed in the mesh) or the left hand
    parent.updateMatrix();
    toCamera.multiplyMatrices(pose.matrix, parent.matrix);
    wrist.copy(bone.position).applyMatrix4(toCamera);
    toParent.multiplyQuaternions(pose.quaternion, parent.quaternion).invert();
    aim.subVectors(elbow, wrist).normalize().applyQuaternion(toParent);
    bone.quaternion.setFromUnitVectors(dir, aim);
  }
}
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
    ejectAt = Infinity; // dead or hidden: no shell on the first frame back
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
    else eject(m);
  }
  springStep(kick, null, k.halflife, dt);
  if (VM?.pose === 'recoil') { // the kick as it stands that long after a shot
    const g = impulseShape(VM.t * 0.25, k.halflife);
    kick.x.set([0, 0, k.back * g, k.up * g, 0, k.roll * g]);
  }
  if (now >= ejectAt) {
    ejectAt = Infinity;
    eject(m);
  }

  // Reload and pump poses straight from the arsenal's timers.
  goal.fill(0);
  partGoal.fill(0);
  leftGoal.fill(0);
  slideAt.fill(0);
  let held = false; // the left hand holds what `shell` draws
  const tracks = shown !== wanted ? null : arsenal.reload > 0 ? m.reload : arsenal.cooldown > 0 ? m.cycle : null;
  if (tracks) {
    const t = tracks === m.reload ? 1 - arsenal.reload / w.reload : 1 / w.rps - arsenal.cooldown;
    sampleTrack(tracks.gun, t, goal);
    sampleTrack(tracks.part, t, partGoal);
    sampleTrack(tracks.left, t, leftGoal);
    sampleTrack(tracks.slide, t, slideAt);
    held = tracks === m.reload && t >= tracks.hold[0] && t < tracks.hold[1];
  }
  springStep(action, goal, LOOK.actionHalflife, dt);
  springStep(part, partGoal, LOOK.actionHalflife, dt);
  springStep(left, leftGoal, LOOK.actionHalflife, dt);
  // While the hand holds the new magazine, the hidden one rides with it, so
  // it shows exactly there when the hand lets go at the seat.
  if (held && m.seat) {
    for (let i = 0; i < 6; i++) {
      part.x[i] = left.x[i] - (m.seat[i] ?? 0);
      part.v[i] = left.v[i];
    }
  }

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
  place(bones.slide, m.pivots.slide, slideAt);
  bones.shell.scale.setScalar(held ? 1 : 0);
  bones.part.scale.setScalar(held && m.seat ? 0 : 1);
  aimForearms(m.arms);

  // The star shows for two frames, the glow, the barrel's heat and the
  // brighter sky light for their times but at least one frame.
  if (fired) {
    flashFrames = LOOK.flash.frames;
    glowUntil = now + LOOK.flash.glowSeconds * 1000;
    pulseUntil = now + LOOK.flash.pulseSeconds * 1000;
    flashMesh.rotation.z = Math.random() * 2 * Math.PI;
  }
  const star = flashFrames > 0 || (VM?.pose === 'recoil' && VM.t <= 0.2);
  if (flashFrames > 0) flashFrames--;
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
