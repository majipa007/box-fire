// Game feel that lives only on the client: the recoil kick and its recovery,
// the camera's bob, landing dip and blast shake, Nitro's fov kick, the
// smoothing that hides prediction corrections, and the crosshair spread for
// the HUD. Plain numbers in and out (no three.js, no DOM), so Node tests
// drive it directly. The spec is docs/bible.md §5.
import {
  WEAPONS, KICK_SPRAY_GAP_MS, KICK_CLIMB_SHOTS, KICK_WOBBLE, SNAP_DISTANCE, RUN_SPEED, WALK_SPEED, PITCH_LIMIT,
} from '../shared/constants.js';
import { spreadDegrees } from '../shared/weapons.js';

// Tuning knobs: ms and metres unless named. A half-life is how long an eased
// value takes to close half of its gap.
export const LOOK = {
  // A prediction correction is drawn as an offset that fades out; one longer
  // than SNAP_DISTANCE is a teleport and snaps.
  correctionHalfLife: 50,

  // Recoil: each shot's kick (WEAPONS.kick) eases into the aim. Once the
  // trigger has rested recoverDelay, recoverShare of the kick the player has
  // not pulled down comes back out on a critically damped spring: no jolt as
  // it starts, halfway back after the half-life. The rest is theirs to keep.
  kickHalfLife: 12, // ~95% of a kick lands within 50 ms
  recoverDelay: 120, // after the last shot; a held automatic never recovers mid-spray
  recoverShare: 0.7,
  recoverHalfLife: 90,

  // Bob moves the eye, never the aim: a dip that bottoms out on each
  // footfall, and a roll that leans onto alternate feet. Both scale with
  // speed / RUN_SPEED, and are off in the air and at bobMinSpeed or slower,
  // where footsteps go quiet too.
  stride: 2.2, // m per footstep
  bobDip: 0.008,
  bobRollDeg: 0.2,
  bobMinSpeed: WALK_SPEED + 0.3, // m/s
  bobFade: 150, // to fade fully in or out

  // Landing: the eye dips by landDipPerVy × the landing speed (a 1 m jump
  // lands at 6.32 m/s, so 0.057 m), then comes back.
  landDipPerVy: 0.009, // m per m/s
  landDipMax: 0.06,
  landDown: 70,
  landBack: 140,

  // Shake: a blast within shakeRange adds trauma (1 − d / shakeRange) ×
  // shakeTrauma, capped at 1. It rolls and moves the eye by trauma², never
  // pitch or yaw, so the aim ray stays put.
  shakeRange: 8,
  shakeTrauma: 0.8,
  traumaDecay: 1.5, // per second
  shakeRollDeg: 1.5,
  shakeMove: 0.06,

  // Nitro widens the view.
  nitroFov: 6, // degrees
  nitroIn: 150,
  nitroOut: 300,

  // Crosshair: the shot cone eased, plus a bloom on every shot. The sim has no
  // firing inaccuracy, so the bloom is short: at rest the gap is the true cone.
  spreadHalfLife: 25,
  bloomPerKick: 0.5, // degrees of bloom per degree of kick
  bloomHalfLife: 80,
  bloomMax: 2,
};

const DEG = Math.PI / 180;
const MAX_DT_MS = 50; // a long hitch eases like a short one instead of leaping
const STILL = { vx: 0, vy: 0, vz: 0, grounded: true, crouch: false, boost: 0 };
// A critically damped spring let go from rest has (1 + u)·e^−u of its gap
// left at time u / w, which is one half at u = 1.6783.
const RECOVER_W = 1.6783469900166605 / LOOK.recoverHalfLife; // per ms

// Outputs, rewritten in place every frame. x, y, z: camera offset from the
// predicted eye (m); roll (rad); fov: degrees to add to the view; step: this
// frame is one of our footfalls, the bottom of a bob dip.
export const view = { x: 0, y: 0, z: 0, roll: 0, fov: 0, step: false };
export const crosshair = { cone: 0, spread: 0 }; // degrees: the true shot cone, and what to draw

let spray = 0; // shots so far in this spray
let lastShotAt = -Infinity;
let kickPitch = 0, kickYaw = 0; // queued kick, not in the aim yet (rad)
let owedPitch = 0, owedYaw = 0; // kick in the aim, not pulled down, not yet handed to recovery (rad)
let backPitch = 0, backYaw = 0, backVPitch = 0, backVYaw = 0; // recovery still to come (rad), and its rate (rad/ms)
let seenPitch = 0, seenYaw = 0; // the aim as we last left it: any change since is the mouse
let corrX = 0, corrY = 0, corrZ = 0; // correction offset (m)
let bloom = 0, spread = 0; // degrees
let bobOn = true;
let bob = 0, phase = 0, foot = 1; // bob strength 0..1; phase 0..π through a stride; the foot that lands next
let dip = 0, dipFrom = 0, dipDepth = 0, dipT = Infinity, airVy = 0, wasGrounded = true;
let trauma = 0;
let nitro = 0; // 0..1 through the fov kick

const ease = (halfLifeMs, dtMs) => 1 - 2 ** (-dtMs / halfLifeMs);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A pull against the owed kick pays that much of it off; a pull with it pays nothing.
const payOff = (owed, moved) => (owed > 0 ? Math.max(0, owed + Math.min(0, moved)) : Math.min(0, owed + Math.max(0, moved)));
// Two sines at unrelated rates: smooth noise in −1..1 that never repeats.
// Keep hz × 2.37 under 30, or a 60 Hz display aliases it into jitter.
const wave = (s, hz, p) => 0.6 * Math.sin(2 * Math.PI * hz * s + p) + 0.4 * Math.sin(2 * Math.PI * hz * 2.37 * s + 2 * p);

// A shot: queue its kick (a step, plus a climb through a spray) and bloom the crosshair.
export function addRecoil(weapon, now) {
  spray = now - lastShotAt < KICK_SPRAY_GAP_MS ? spray + 1 : 1;
  lastShotAt = now;
  const [base, climb] = WEAPONS[weapon].kick;
  const deg = base + climb * Math.min(spray, KICK_CLIMB_SHOTS);
  kickPitch += deg * DEG;
  kickYaw += (Math.random() - 0.5) * deg * DEG * KICK_WOBBLE;
  bloom = Math.min(LOOK.bloomMax, bloom + deg * LOOK.bloomPerKick);
}

// Reconcile moved our player by d ({ x, y, z }): keep drawing them where they
// were, and let the gap fade.
export function correct(d) {
  corrX -= d.x;
  corrY -= d.y;
  corrZ -= d.z;
  if (Math.hypot(corrX, corrY, corrZ) > SNAP_DISTANCE) corrX = corrY = corrZ = 0;
}

export const addTrauma = (amount) => { trauma = Math.min(1, trauma + amount); };

// A blast event ('blast' today, the bible's 'boom' later) shakes the camera
// when it goes off near our mover. Bolt impacts and fizzles (r 0) are not
// blasts, and our own Barge goes off on us (one with no id may be ours).
export function blastShake(m, myId, me) {
  if (!me || m.k === 'bolt' || m.r === 0 || (m.k === 'barge' && (m.id ?? myId) === myId)) return;
  const d = Math.hypot(m.x - me.x, m.y - (me.y + 1), m.z - me.z); // from our chest
  if (d < LOOK.shakeRange) addTrauma((1 - d / LOOK.shakeRange) * LOOK.shakeTrauma);
}

// The "View bob" setting, on unless false. Footfalls (view.step) still come when it is off.
export const setBob = (on) => { bobOn = on !== false; };

// updateFeel's trigger: fire is held and a shot can still come. An empty mag,
// a reload or a weapon switch ends the spray, so recovery starts on time.
export const spraying = (a) => a.trigger && a.mags[a.slot] > 0 && !(a.reload > 0) && !(a.switching > 0);

// A new life: no kick owed, no offsets, not mid-air.
export function resetFeel() {
  spray = 0;
  lastShotAt = -Infinity;
  kickPitch = kickYaw = owedPitch = owedYaw = 0;
  backPitch = backYaw = backVPitch = backVYaw = 0;
  corrX = corrY = corrZ = 0;
  bloom = bob = dip = dipFrom = dipDepth = airVy = trauma = nitro = 0;
  dipT = Infinity;
  wasGrounded = true;
}

// Once per frame, before the camera is placed. look is the live aim
// ({ yaw, pitch }), which this kicks and recovers; me is our mover, or null
// when we are not playing; trigger is spraying(arsenal).
// Returns view.
export function updateFeel(frameMs, now, look, me, weapon, trigger) {
  const dt = Math.min(frameMs, MAX_DT_MS);
  me ??= STILL;

  // Recoil. Only the mouse moves the aim between our calls, so whatever moved
  // it pulled against the kick or not: first against the recovery under way,
  // then against what is owed. Shots land on 60 Hz steps with timer jitter,
  // so a held automatic is a spray however late its next shot is.
  // Paying off part of the recovery scales its rate with it, so the spring
  // stays on a path that ends at zero instead of swinging past where the
  // player put the aim.
  let pull = look.pitch - seenPitch;
  let left = payOff(backPitch, pull);
  backVPitch = backPitch ? (backVPitch * left) / backPitch : 0;
  pull += backPitch - (backPitch = left);
  owedPitch = payOff(owedPitch, pull);
  pull = look.yaw - seenYaw;
  left = payOff(backYaw, pull);
  backVYaw = backYaw ? (backVYaw * left) / backYaw : 0;
  pull += backYaw - (backYaw = left);
  owedYaw = payOff(owedYaw, pull);
  let backP = 0, backY = 0; // recovered this frame
  if (!(trigger && WEAPONS[weapon].auto) && now - lastShotAt > LOOK.recoverDelay) {
    backPitch += owedPitch * LOOK.recoverShare;
    backYaw += owedYaw * LOOK.recoverShare;
    owedPitch = owedYaw = 0;
    // The spring toward nothing left, solved exactly for this dt.
    const e = Math.exp(-RECOVER_W * dt);
    let j = backVPitch + backPitch * RECOVER_W;
    backP = backPitch - e * (backPitch + j * dt);
    backVPitch = e * (backVPitch - j * RECOVER_W * dt);
    j = backVYaw + backYaw * RECOVER_W;
    backY = backYaw - e * (backYaw + j * dt);
    backVYaw = e * (backVYaw - j * RECOVER_W * dt);
    backPitch -= backP;
    backYaw -= backY;
  } else backVPitch = backVYaw = 0; // a shot pauses it; what is left resumes after the next delay
  const k = ease(LOOK.kickHalfLife, dt);
  const pitch = clamp(look.pitch + kickPitch * k - backP, -PITCH_LIMIT, PITCH_LIMIT);
  const yaw = look.yaw + kickYaw * k - backY;
  owedPitch += pitch - look.pitch + backP; // the kick that actually landed, after the clamp
  owedYaw += kickYaw * k;
  kickPitch -= kickPitch * k;
  kickYaw -= kickYaw * k;
  look.pitch = seenPitch = pitch;
  look.yaw = seenYaw = yaw;

  // Crosshair.
  crosshair.cone = spreadDegrees(weapon, me);
  spread += (crosshair.cone - spread) * ease(LOOK.spreadHalfLife, dt);
  bloom *= 2 ** (-dt / LOOK.bloomHalfLife);
  crosshair.spread = spread + bloom;

  // Bob. phase runs 0..π through each stride and wraps on the footfall.
  const speed = Math.hypot(me.vx, me.vz);
  const striding = me.grounded && speed > LOOK.bobMinSpeed;
  const target = striding && bobOn ? Math.min(1, speed / RUN_SPEED) : 0;
  bob = bob < target ? Math.min(target, bob + dt / LOOK.bobFade) : Math.max(target, bob - dt / LOOK.bobFade);
  view.step = false;
  if (striding) {
    phase += (Math.PI * speed * dt) / 1000 / LOOK.stride;
    if (phase >= Math.PI) {
      phase -= Math.PI;
      foot = -foot;
      view.step = true;
    }
  }
  const bobY = -LOOK.bobDip * bob * (1 - Math.sin(phase));
  const bobRoll = LOOK.bobRollDeg * DEG * bob * foot * Math.cos(phase); // leans onto each foot as it lands

  // Landing dip: down, then back. step() zeroes vy on touchdown, so remember
  // the fall speed. A landing mid-dip carries on down from where the eye is.
  if (!me.grounded) airVy = Math.min(airVy, me.vy);
  else if (!wasGrounded) {
    dipDepth = Math.max(dip, Math.min(LOOK.landDipMax, -LOOK.landDipPerVy * airVy));
    dipFrom = dip;
    dipT = 0;
    airVy = 0;
  }
  wasGrounded = me.grounded;
  dipT += dt;
  if (dipT < LOOK.landDown) dip = dipFrom + (dipDepth - dipFrom) * Math.sin(((Math.PI / 2) * dipT) / LOOK.landDown);
  else if (dipT < LOOK.landDown + LOOK.landBack) dip = (dipDepth * (1 + Math.cos((Math.PI * (dipT - LOOK.landDown)) / LOOK.landBack))) / 2;
  else dip = 0;

  // Shake.
  trauma = Math.max(0, trauma - (LOOK.traumaDecay * dt) / 1000);
  const t2 = trauma * trauma;
  const s = now / 1000;
  const shakeX = LOOK.shakeMove * t2 * wave(s, 8.3, 0.4); // along our right
  const shakeY = LOOK.shakeMove * t2 * wave(s, 9.7, 2.1);
  const shakeRoll = LOOK.shakeRollDeg * DEG * t2 * wave(s, 6.1, 4.3);

  // Nitro fov, eased in and out (smoothstep).
  nitro = me.boost > 0 ? Math.min(1, nitro + dt / LOOK.nitroIn) : Math.max(0, nitro - dt / LOOK.nitroOut);
  view.fov = LOOK.nitroFov * nitro * nitro * (3 - 2 * nitro);

  const fade = 2 ** (-dt / LOOK.correctionHalfLife);
  corrX *= fade;
  corrY *= fade;
  corrZ *= fade;
  view.x = corrX + Math.cos(yaw) * shakeX;
  view.y = corrY + bobY - dip + shakeY;
  view.z = corrZ - Math.sin(yaw) * shakeX;
  view.roll = bobRoll + shakeRoll;
  return view;
}

// CSS px from the screen centre to the edge of a cone of deg degrees, for a
// camera with this vertical fov on a viewport this tall.
export const spreadPixels = (deg, vfovDeg, heightPx) => ((heightPx / 2) * Math.tan(deg * DEG)) / Math.tan((vfovDeg * DEG) / 2);

// For the ?debug stats line.
export const feelStats = () =>
  `spread ${crosshair.spread.toFixed(2)}° · owed ${((owedPitch + backPitch) / DEG).toFixed(2)}° · corr ${Math.round(Math.hypot(corrX, corrY, corrZ) * 1000)} mm` +
  ` · bob ${bob.toFixed(2)} · dip ${Math.round(dip * 1000)} mm · trauma ${trauma.toFixed(2)} · fov +${view.fov.toFixed(1)}°`;
