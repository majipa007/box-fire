// Power-ups, the shared part: where the pads are, the slot queue that both
// sides step once per input, and the two effects that live in the mover
// (Nitro's boost timer and knockback), so prediction replays them exactly.
// The numbers are in constants.js; the server does everything else.
import { POWERUPS, PICKUP_RADIUS, PICKUP_REACH } from './constants.js';
import { KEY } from './movement.js';

// Pickup pads per map: [x, y, z, kind], with y the floor under the pad.
// Point-symmetric pairs plus the centre, all on open floor at least 5 m from
// any spawn (powerups.test.js checks this for every map listed).
export const PADS = {
  arena_01: [
    [0, 0, 0, 'shunt'],
    [15, 0, 7, 'nitro'], [-15, 0, -7, 'nitro'],
    [10, 0, 17, 'repair'], [-10, 0, -17, 'repair'],
    [10, 0, -17, 'shield'], [-10, 0, 17, 'shield'],
    [5.5, 0, -3.5, 'bolt'], [-5.5, 0, 3.5, 'bolt'],
    [4, 0, -10, 'mine'], [-4, 0, 10, 'mine'],
    [15, 0, -5, 'barge'], [-15, 0, 5, 'barge'],
  ],
};

export const padsFor = (mapId) => PADS[mapId] ?? [];

// Is a mover (feet-anchored) standing on, or jumping through, the pad at x, y, z?
export const onPad = (m, x, y, z) => Math.hypot(m.x - x, m.z - z) <= PICKUP_RADIUS && m.y >= y - 0.25 && m.y <= y + PICKUP_REACH;

// One fixed step of the slot queue, run before movement on both sides with
// the input's keys: cycle moves the first power-up to the back, use takes
// the first. Nitro starts here, so the very same step already runs boosted.
// Returns the kind used, or null.
export function stepPowerups(inv, mover, keys) {
  if (keys & KEY.CYCLE && inv.length > 1) inv.push(inv.shift());
  if (!(keys & KEY.USE) || !inv.length) return null;
  const kind = inv.shift();
  if (kind === 'nitro') mover.boost = POWERUPS.nitro.seconds;
  return kind;
}

// A knockback: `speed` m/s along (dx, dz) plus `lift` m/s up. The server
// applies it; it lives in the mover, so the client's replays carry it.
export function knock(m, dx, dz, speed, lift) {
  const len = Math.hypot(dx, dz);
  if (len > 0 && speed > 0) {
    m.kx += (dx / len) * speed;
    m.kz += (dz / len) * speed;
  }
  if (lift > 0) {
    m.vy = Math.max(m.vy, lift);
    m.grounded = false;
  }
}
