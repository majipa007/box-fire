// The one movement step, run identically by the client (prediction) and the
// server (authority) with a fixed dt. No randomness, no clocks.
import { DT, GRAVITY, PLAYER_WIDTH, STAND_HEIGHT, RUN_SPEED, GROUND_ACCEL, AIR_CONTROL, JUMP_HEIGHT } from './constants.js';
import { sweep } from './collision.js';

const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);

export const KEY = { FORWARD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, WALK: 32, CROUCH: 64, RELOAD: 128 };

export const createMover = (x, y, z) => ({ x, y, z, vx: 0, vy: 0, vz: 0, grounded: false });

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
  const [wx, wz] = wishVelocity(input.keys, input.yaw, RUN_SPEED);

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
    const moved = sweep(s, half, STAND_HEIGHT, axis, want, boxes);
    s[key] += moved;
    if (moved !== want) s[v] = 0;
  }

  if (s.grounded && input.keys & KEY.JUMP) s.vy = JUMP_VELOCITY;

  // Exact ballistic integration, so jump height does not depend on dt.
  const dy = s.vy * DT - 0.5 * GRAVITY * DT * DT;
  s.vy -= GRAVITY * DT;
  const moved = sweep(s, half, STAND_HEIGHT, 1, dy, boxes);
  s.y += moved;
  s.grounded = dy < 0 && moved > dy;
  if (moved !== dy) s.vy = 0;
}
