// Weapon state, stepped once per input exactly like movement, so the client
// predicts shots, ammo and reloads and the server agrees.
import {
  DT, WEAPONS, SWITCH_SECONDS, SHOT_RANGE, MAX_HP, SPREAD_AIR_FACTOR, SPREAD_CROUCH_FACTOR, EYE_STAND, EYE_CROUCH, STAND_HEIGHT, CROUCH_HEIGHT, PLAYER_WIDTH, HEAD_SIZE, RUN_SPEED,
} from './constants.js';
import { KEY, createMover } from './movement.js';
import { rayBox } from './collision.js';

// slot 0 is the primary, slot 1 the pistol.
export const createArsenal = (primary) => ({
  primary,
  slot: 0,
  mags: [WEAPONS[primary].mag, WEAPONS.pistol.mag],
  cooldown: 0, // seconds until the next shot; carries its remainder
  reload: 0, // seconds of reload left, 0 when not reloading
  switching: 0, // seconds until a newly drawn weapon can fire
  trigger: false, // trigger state last step, for semi-auto edges
});

export const weaponOf = (a) => (a.slot === 0 ? a.primary : 'pistol');

// Everything a player's state holds at the moment they spawn. Server and
// client both build it here, so a new life starts identical on both sides.
export const freshLife = (x, y, z, primary) => ({
  mover: { ...createMover(x, y, z), grounded: true }, // spawns sit on a surface
  arsenal: createArsenal(primary),
  hp: MAX_HP,
  alive: true,
});

// Where a player's shot starts and which way it goes (yaw 0 faces -z).
export const eyeOf = (m) => [m.x, m.y + (m.crouch ? EYE_CROUCH : EYE_STAND), m.z];
export const aimDir = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

// Spread cone half-angle in degrees: blended from standing to moving by
// ground speed, doubled in the air, tightened when crouched.
export function spreadDegrees(weapon, m) {
  const w = WEAPONS[weapon];
  if (!m.grounded) return SPREAD_AIR_FACTOR * w.spreadMove;
  if (m.crouch) return SPREAD_CROUCH_FACTOR * w.spreadStand;
  const t = Math.min(1, Math.hypot(m.vx, m.vz) / RUN_SPEED);
  return w.spreadStand + (w.spreadMove - w.spreadStand) * t;
}

// The direction of each pellet (one for the rifle and pistol), spread
// uniformly over the cone by the shot's seeded generator.
export function shotDirs(yaw, pitch, weapon, m, rand) {
  const fwd = aimDir(yaw, pitch);
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const cone = Math.tan((spreadDegrees(weapon, m) * Math.PI) / 180);
  return Array.from({ length: WEAPONS[weapon].pellets ?? 1 }, () => {
    const r = Math.sqrt(rand()) * cone;
    const a = 2 * Math.PI * rand();
    const d = fwd.map((f, i) => f + right[i] * r * Math.cos(a) + up[i] * r * Math.sin(a));
    const len = Math.hypot(...d);
    return d.map((v) => v / len);
  });
}

// Damage of one hit (one pellet for the shotgun) at a distance in metres.
export function damageAt(weapon, head, dist) {
  const w = WEAPONS[weapon];
  const f = w.falloff;
  const scale = !f || dist <= f.from ? 1 : Math.max(f.min, 1 - ((1 - f.min) * (dist - f.from)) / (f.to - f.from));
  return w.dmg * (head ? w.head : 1) * scale;
}

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
  if (a.switching > 0) a.switching = Math.max(0, a.switching - DT);
  if (input.slot !== a.slot) {
    a.slot = input.slot;
    a.switching = SWITCH_SECONDS; // can't fire until the new gun is up
    a.reload = 0; // switching cancels a reload
  }
  const w = WEAPONS[weaponOf(a)];
  if (a.reload > 0) {
    a.reload -= DT;
    if (a.reload <= 1e-9) {
      // Shell-by-shell weapons load one at a time and keep going until full.
      a.mags[a.slot] = w.perShell ? a.mags[a.slot] + 1 : w.mag;
      a.reload = w.perShell && a.mags[a.slot] < w.mag ? w.reload : 0;
    }
  }
  a.cooldown -= DT;
  let fired = false;
  // Automatic weapons fire while held; semi-automatic ones once per click.
  const pull = input.fire && (w.auto || !a.trigger);
  if (pull && w.perShell && a.reload > 0 && a.mags[a.slot] > 0) a.reload = 0; // a shot interrupts loading
  if (pull && a.switching < 1e-9 && a.reload === 0 && a.cooldown <= 0) {
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
