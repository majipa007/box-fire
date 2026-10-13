// The one movement step, run identically by the client (prediction) and the
// server (authority) with a fixed dt. No randomness, no clocks.
import {
  DT, GRAVITY, PLAYER_WIDTH, STAND_HEIGHT, RUN_SPEED, WALK_SPEED, CROUCH_SPEED,
  GROUND_ACCEL, AIR_CONTROL, JUMP_HEIGHT, CROUCH_HEIGHT,
  POWERS, COYOTE_TICKS, JUMP_BUFFER_TICKS, KNOCK_MAX, // POWER-UPS, FEEL
} from './constants.js';
import { sweep, overlaps } from './collision.js';

const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);

// POWER-UPS: USE uses the selected item and CYCLE selects the next; both are
// press-once bits, like JUMP.
export const KEY = { FORWARD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, WALK: 32, CROUCH: 64, RELOAD: 128, USE: 256, CYCLE: 512 };

// POWER-UPS: boost (Nitro) and slow (Shock) are ticks left. FEEL: coyote and
// jumpBuf are ticks left in the coyote-time and jump-buffer windows. All
// live in the mover, so a reconcile replays them exactly.
export const createMover = (x, y, z) => ({ x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, crouch: false, boost: 0, slow: 0, coyote: 0, jumpBuf: 0 });

// yaw 0 faces -z; forward is (-sin, -cos) and right is (cos, -sin).
function wishVelocity(keys, yaw, speed) {
  const fwd = (keys & KEY.FORWARD ? 1 : 0) - (keys & KEY.BACK ? 1 : 0);
  const side = (keys & KEY.RIGHT ? 1 : 0) - (keys & KEY.LEFT ? 1 : 0);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const x = -sin * fwd + cos * side;
  const z = -cos * fwd - sin * side;
  const len = Math.hypot(x, z);
  return len ? [(x / len) * speed, (z / len) * speed] : [0, 0];
}

export function step(s, input, boxes) {
  const half = PLAYER_WIDTH / 2;
  const keys = input.keys;
  // Crouch shrinks the box from the top, in the air too, so the feet never
  // move. Standing back up waits until there is headroom.
  if (keys & KEY.CROUCH) s.crouch = true;
  else if (s.crouch && !overlaps(s, half, STAND_HEIGHT, boxes)) s.crouch = false;
  const height = s.crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
  const speed = (s.crouch ? CROUCH_SPEED : keys & KEY.WALK ? WALK_SPEED : RUN_SPEED)
    * (s.boost > 0 ? POWERS.nitro.speed : 1) * (s.slow > 0 ? POWERS.shock.slow : 1); // POWER-UPS: Nitro, Shock
  const [wx, wz] = wishVelocity(keys, input.yaw, speed);

  // Velocity moves straight toward the wish velocity, so speed can never
  // exceed the target (no air-strafe gain). In the air without input,
  // momentum is kept.
  if (s.grounded || wx || wz) {
    const dx = wx - s.vx;
    const dz = wz - s.vz;
    const gap = Math.hypot(dx, dz);
    const accel = GROUND_ACCEL * DT * (s.grounded ? 1 : AIR_CONTROL);
    if (gap <= accel) { s.vx = wx; s.vz = wz; } else { s.vx += (dx / gap) * accel; s.vz += (dz / gap) * accel; }
  }

  for (const [axis, key, v] of [[0, 'x', 'vx'], [2, 'z', 'vz']]) {
    const want = s[v] * DT;
    const moved = sweep(s, half, height, axis, want, boxes);
    s[key] += moved;
    if (moved !== want) s[v] = 0;
  }

  // FEEL: a press is buffered for JUMP_BUFFER_TICKS before landing, and a
  // jump still works COYOTE_TICKS after walking off an edge. Both windows
  // count the tick they open on, hence the + 1 below.
  if (keys & KEY.JUMP) s.jumpBuf = JUMP_BUFFER_TICKS + 1;
  if ((s.grounded || s.coyote > 0) && s.jumpBuf > 0) {
    s.vy = JUMP_VELOCITY;
    s.jumpBuf = 0;
    s.coyote = 0;
  }

  // Exact ballistic integration, so jump height does not depend on dt.
  const dy = s.vy * DT - 0.5 * GRAVITY * DT * DT;
  s.vy -= GRAVITY * DT;
  const moved = sweep(s, half, height, 1, dy, boxes);
  s.y += moved;
  s.grounded = dy < 0 && moved > dy;
  if (moved !== dy) s.vy = 0;

  s.coyote = s.grounded ? COYOTE_TICKS + 1 : Math.max(0, s.coyote - 1); // FEEL
  if (s.jumpBuf > 0) s.jumpBuf--;
  if (s.boost > 0) s.boost--; // POWER-UPS
  if (s.slow > 0) s.slow--;
}

// POWER-UPS: a blast's push. The horizontal impulse adds to the velocity and
// the sum is clamped to KNOCK_MAX; lift only applies on the ground, so no
// knock ever adds height to a jump. A knocked player can't jump out of it.
export function knock(s, vx, vz, lift) {
  s.vx += vx;
  s.vz += vz;
  const h = Math.hypot(s.vx, s.vz);
  if (h > KNOCK_MAX) {
    s.vx *= KNOCK_MAX / h;
    s.vz *= KNOCK_MAX / h;
  }
  if (s.grounded) {
    s.vy = Math.max(s.vy, lift);
    s.grounded = false;
  }
  s.coyote = 0;
  s.jumpBuf = 0;
}
