// Weapon state, stepped once per input exactly like movement, so the client
// predicts shots, ammo and reloads and the server agrees.
import {
  DT, WEAPONS, SHOT_RANGE, EYE_STAND, EYE_CROUCH, STAND_HEIGHT, CROUCH_HEIGHT, PLAYER_WIDTH, HEAD_SIZE,
} from './constants.js';
import { KEY } from './movement.js';
import { rayBox } from './collision.js';

// slot 0 is the primary, slot 1 the pistol.
export const createArsenal = (primary = 'rifle') => ({
  primary,
  slot: 0,
  mags: [WEAPONS[primary].mag, WEAPONS.pistol.mag],
  cooldown: 0, // seconds until the next shot; carries its remainder
  reload: 0, // seconds of reload left, 0 when not reloading
  trigger: false, // trigger state last step, for semi-auto edges
});

export const weaponOf = (a) => (a.slot === 0 ? a.primary : 'pistol');

// Where a player's shot starts and which way it goes (yaw 0 faces -z).
export const eyeOf = (m) => [m.x, m.y + (m.crouch ? EYE_CROUCH : EYE_STAND), m.z];
export const aimDir = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

// Two boxes per player, matching the drawn model: a 0.3 m head cube on top of
// a 1.5 m body standing, or a 0.9 m body crouched.
export function hitboxes({ x, y, z, crouch }) {
  const top = y + (crouch ? CROUCH_HEIGHT : STAND_HEIGHT) - HEAD_SIZE;
  const h = HEAD_SIZE / 2;
  const r = PLAYER_WIDTH / 2;
  return {
    head: { min: [x - h, top, z - h], max: [x + h, top + HEAD_SIZE, z + h] },
    body: { min: [x - r, y, z - r], max: [x + r, top, z + r] },
  };
}

// Follow a shot through the map and the targets ({ id, x, y, z, crouch }).
// Each player's head is tested first; the nearest player in front of the
// nearest wall is hit. Returns { id, head, t } with id null for a miss.
export function traceShot(origin, dir, boxes, targets) {
  let t = SHOT_RANGE;
  for (const b of boxes) t = Math.min(t, rayBox(origin, dir, b.min, b.max));
  let hit = { id: null, head: false, t };
  for (const p of targets) {
    const { head, body } = hitboxes(p);
    const th = rayBox(origin, dir, head.min, head.max);
    const [d, isHead] = th < Infinity ? [th, true] : [rayBox(origin, dir, body.min, body.max), false];
    if (d < hit.t) hit = { id: p.id, head: isHead, t: d };
  }
  return hit;
}

// One fixed step. Returns true when a shot fires.
export function stepWeapon(a, input) {
  const w = WEAPONS[weaponOf(a)];
  if (a.reload > 0) {
    a.reload -= DT;
    if (a.reload <= 1e-9) {
      a.reload = 0;
      a.mags[a.slot] = w.mag;
    }
  }
  a.cooldown -= DT;
  let fired = false;
  if (input.fire && a.reload === 0 && a.cooldown <= 0) {
    if (a.mags[a.slot] > 0) {
      a.mags[a.slot]--;
      a.cooldown += 1 / w.rps; // += keeps the remainder: 9.75/s is 6.15 steps
      fired = true;
    } else {
      a.reload = w.reload; // pulling on an empty magazine reloads it
    }
  }
  // Without this clamp a released trigger would bank shots for a burst.
  if (!fired) a.cooldown = Math.max(a.cooldown, 0);
  if (input.keys & KEY.RELOAD && a.reload === 0 && a.mags[a.slot] < w.mag) a.reload = w.reload;
  a.trigger = input.fire;
  return fired;
}
