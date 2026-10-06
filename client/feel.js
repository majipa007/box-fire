// Game feel that lives only on the client: the recoil kick and its recovery,
// the camera's bob, landing dip and strafe roll, the smoothing that hides
// prediction corrections, and the crosshair spread for the HUD. Plain numbers
// in and out (no three.js, no DOM), so Node tests drive it directly.
import {
  WEAPONS, KICK_SPRAY_GAP_MS, KICK_CLIMB_SHOTS, KICK_WOBBLE, SNAP_DISTANCE, RUN_SPEED, PITCH_LIMIT, GRAVITY, JUMP_HEIGHT,
} from '../shared/constants.js';
import { spreadDegrees } from '../shared/weapons.js';

// Tuning knobs. A half-life is how long an eased value takes to close half
// of what is left of its gap.

// A prediction correction is drawn as an offset that fades out; one longer
// than SNAP_DISTANCE is a teleport and snaps.
export const CORRECTION_HALF_LIFE_MS = 50;

// Recoil: each shot's kick eases into the real aim. Once the trigger rests,
// it eases back out, but only the part the player has not pulled down.
export const KICK_HALF_LIFE_MS = 12; // ~95% of a kick lands within 50 ms
export const RECOVER_DELAY_MS = 120; // after the last shot; a held automatic never recovers mid-spray
export const RECOVER_HALF_LIFE_MS = 80;
export const RECOVER_MAX_DEG = 8; // owed kick beyond this stays: a long uncontrolled spray is not undone

// Camera bob. It moves the eye, never the aim, so the crosshair stays on the shot ray.
export const BOB_STRIDE_M = 2.2; // one footfall dip per stride, like the footsteps
export const BOB_DEPTH_M = 0.012; // footfall dip at run speed
export const BOB_SWAY_M = 0.006; // side to side, once per two strides
export const BOB_HALF_LIFE_MS = 60; // fades in and out as you start and stop

// Landing: the eye dips, then springs back (critically damped).
export const LAND_DIP_M = 0.04; // after a full jump; scales with landing speed
export const LAND_DIP_MAX_M = 0.08;
export const LAND_DIP_PEAK_MS = 70; // lowest this long after touchdown

// Strafing leans the camera into the move. Roll keeps the screen centre fixed.
export const STRAFE_ROLL_DEG = 0.6; // at run speed
export const ROLL_HALF_LIFE_MS = 70;

// Crosshair: the shot cone eased, plus a bloom on every shot. The sim has no
// firing inaccuracy, so the bloom is short: at rest the gap is the true cone.
export const SPREAD_HALF_LIFE_MS = 25;
export const BLOOM_PER_KICK = 0.5; // degrees of bloom per degree of kick
export const BLOOM_HALF_LIFE_MS = 80;
export const BLOOM_MAX_DEG = 2;

const DEG = Math.PI / 180;
const JUMP_LANDING_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT); // m/s
const MAX_DT_MS = 50; // a long hitch eases like a short one instead of leaping
const STILL = { vx: 0, vy: 0, vz: 0, grounded: true, crouch: false };

// Outputs, rewritten in place every frame.
export const view = { x: 0, y: 0, z: 0, roll: 0 }; // camera offset from the predicted eye (m), and roll (rad)
export const crosshair = { cone: 0, spread: 0 }; // degrees: the true shot cone, and what to draw

let spray = 0; // shots so far in this spray
let lastShotAt = -Infinity;
let kickPitch = 0, kickYaw = 0; // queued kick, not in the aim yet (rad)
let owedPitch = 0, owedYaw = 0; // kick in the aim, not yet recovered or pulled down (rad)
let seenPitch = 0, seenYaw = 0; // the aim as we last left it: any change since is the mouse
let corrX = 0, corrY = 0, corrZ = 0; // correction offset (m)
let bloom = 0, spread = 0; // degrees
let phase = 0, bob = 0, roll = 0;
let dip = 0, dipV = 0, airVy = 0, wasGrounded = true;

const ease = (halfLifeMs, dtMs) => 1 - 2 ** (-dtMs / halfLifeMs);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A pull against the owed kick pays that much of it off; a pull with it pays nothing.
const payOff = (owed, moved) => (owed > 0 ? Math.max(0, owed + Math.min(0, moved)) : Math.min(0, owed + Math.max(0, moved)));

// A shot: queue its kick (a step, plus a climb through a spray) and bloom the crosshair.
export function addRecoil(weapon, now) {
  spray = now - lastShotAt < KICK_SPRAY_GAP_MS ? spray + 1 : 1;
  lastShotAt = now;
  const [base, climb] = WEAPONS[weapon].kick;
  const deg = base + climb * Math.min(spray, KICK_CLIMB_SHOTS);
  kickPitch += deg * DEG;
  kickYaw += (Math.random() - 0.5) * deg * DEG * KICK_WOBBLE;
  bloom = Math.min(BLOOM_MAX_DEG, bloom + deg * BLOOM_PER_KICK);
}

// Reconcile moved our player by d ({ x, y, z }): keep drawing them where they
// were, and let the gap fade.
export function correct(d) {
  corrX -= d.x;
  corrY -= d.y;
  corrZ -= d.z;
  if (Math.hypot(corrX, corrY, corrZ) > SNAP_DISTANCE) corrX = corrY = corrZ = 0;
}

// A new life: no kick owed, no offsets, not mid-air.
export function resetFeel() {
  spray = 0;
  lastShotAt = -Infinity;
  kickPitch = kickYaw = owedPitch = owedYaw = 0;
  corrX = corrY = corrZ = 0;
  bloom = dip = dipV = airVy = 0;
  wasGrounded = true;
}

// Once per frame, before the camera is placed. look is the live aim
// ({ yaw, pitch }), which this kicks and recovers; me is our mover, or null
// when we are not playing; trigger is whether the last step held fire.
// Returns view.
export function updateFeel(frameMs, now, look, me, weapon, trigger) {
  const dt = Math.min(frameMs, MAX_DT_MS);
  me ??= STILL;

  // Recoil. Only the mouse moves the aim between our calls, so whatever moved
  // it pulled against the kick or not. Shots land on 60 Hz steps with timer
  // jitter, so a held automatic is a spray however late its next shot is.
  owedPitch = payOff(owedPitch, look.pitch - seenPitch);
  owedYaw = payOff(owedYaw, look.yaw - seenYaw);
  const k = ease(KICK_HALF_LIFE_MS, dt);
  const spraying = trigger && WEAPONS[weapon].auto;
  const r = !spraying && now - lastShotAt > RECOVER_DELAY_MS ? ease(RECOVER_HALF_LIFE_MS, dt) : 0;
  const pitch = clamp(look.pitch + kickPitch * k - owedPitch * r, -PITCH_LIMIT, PITCH_LIMIT);
  const yaw = look.yaw + kickYaw * k - owedYaw * r;
  kickPitch -= kickPitch * k;
  kickYaw -= kickYaw * k;
  const max = RECOVER_MAX_DEG * DEG;
  owedPitch = clamp(owedPitch + pitch - look.pitch, -max, max); // what actually moved, after the clamp
  owedYaw = clamp(owedYaw + yaw - look.yaw, -max, max);
  look.pitch = seenPitch = pitch;
  look.yaw = seenYaw = yaw;

  // Crosshair.
  crosshair.cone = spreadDegrees(weapon, me);
  spread += (crosshair.cone - spread) * ease(SPREAD_HALF_LIFE_MS, dt);
  bloom *= 2 ** (-dt / BLOOM_HALF_LIFE_MS);
  crosshair.spread = spread + bloom;

  // Bob: a dip at each footfall, a sway across two strides.
  const speed = Math.hypot(me.vx, me.vz);
  bob += ((me.grounded ? Math.min(1, speed / RUN_SPEED) : 0) - bob) * ease(BOB_HALF_LIFE_MS, dt);
  if (me.grounded) phase = (phase + (Math.PI * speed * dt) / 1000 / BOB_STRIDE_M) % (2 * Math.PI);
  const sway = BOB_SWAY_M * bob * Math.sin(phase);
  const lift = -BOB_DEPTH_M * bob * (1 - Math.abs(Math.sin(phase)));

  // Landing dip. step() zeroes vy on touchdown, so remember the fall speed.
  if (!me.grounded) airVy = Math.min(airVy, me.vy);
  else if (!wasGrounded) {
    dipV -= (Math.min(LAND_DIP_MAX_M, (LAND_DIP_M * -airVy) / JUMP_LANDING_SPEED) * Math.E * 1000) / LAND_DIP_PEAK_MS;
    airVy = 0;
  }
  wasGrounded = me.grounded;
  const w = 1000 / LAND_DIP_PEAK_MS; // critically damped spring, solved exactly for any dt
  const s = dt / 1000;
  const j = dipV + dip * w;
  const e = Math.exp(-w * s);
  dip = e * (dip + j * s);
  dipV = e * (dipV - j * w * s);

  // Strafe roll: + side speed is to our right; leaning right is a negative roll.
  const side = me.vx * Math.cos(yaw) - me.vz * Math.sin(yaw);
  roll += (-STRAFE_ROLL_DEG * DEG * clamp(side / RUN_SPEED, -1, 1) - roll) * ease(ROLL_HALF_LIFE_MS, dt);

  const fade = 2 ** (-dt / CORRECTION_HALF_LIFE_MS);
  corrX *= fade;
  corrY *= fade;
  corrZ *= fade;
  view.x = corrX + Math.cos(yaw) * sway;
  view.y = corrY + lift + dip;
  view.z = corrZ - Math.sin(yaw) * sway;
  view.roll = roll;
  return view;
}

// CSS px from the screen centre to the edge of a cone of deg degrees, for a
// camera with this vertical fov on a viewport this tall.
export const spreadPixels = (deg, vfovDeg, heightPx) => ((heightPx / 2) * Math.tan(deg * DEG)) / Math.tan((vfovDeg * DEG) / 2);

// For the ?debug stats line.
export const feelStats = () =>
  `spread ${crosshair.spread.toFixed(2)}° · owed ${(owedPitch / DEG).toFixed(2)}° · corr ${Math.round(Math.hypot(corrX, corrY, corrZ) * 1000)} mm · roll ${(roll / DEG).toFixed(2)}°`;
