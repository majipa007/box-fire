// Weapon state, stepped once per input exactly like movement, so the client
// predicts shots, ammo and reloads and the server agrees.
import {
  DT, WEAPONS, SWITCH_SECONDS, SHOT_RANGE, MAX_HP, SPREAD_AIR_FACTOR, SPREAD_CROUCH_FACTOR, EYE_STAND, EYE_CROUCH, STAND_HEIGHT, CROUCH_HEIGHT, PLAYER_WIDTH, HEAD_SIZE, RUN_SPEED,
HEAT_COOL, } from './constants.js';
import { KEY, createMover } from './movement.js';
import { rayBox } from './collision.js';

// slot 0 is the primary, slot 1 the sidearm (arsenal: any registry secondary).
export const createArsenal = (primary, secondary = 'pistol') => ({
  primary,
  secondary,
  slot: 0,
  mags: [WEAPONS[primary].mag, WEAPONS[secondary].mag],
  cooldown: 0, // seconds until the next shot; carries its remainder
  reload: 0, // seconds of reload left, 0 when not reloading
  switching: 0, // seconds until a newly drawn weapon can fire
  trigger: false, // trigger state last step, for semi-auto edges
  heat: 0, // spray heat: +1 a shot, -cool a second; widens the cone by bloom
  burst: 0, // arsenal: shots left in the burst under way
  scope: 0, // arsenal: seconds scoped in, up to the held gun's scope.inSeconds
});

// arsenal: fully scoped in (only then does the scoped cone apply), and how
// far in, 0..1, for the client's fov and sensitivity.
export const scopedIn = (a) => !!WEAPONS[weaponOf(a)].scope && a.scope >= WEAPONS[weaponOf(a)].scope.inSeconds;
export const scopeShare = (a) => (WEAPONS[weaponOf(a)].scope ? Math.min(1, a.scope / WEAPONS[weaponOf(a)].scope.inSeconds) : 0);

// arsenal: the held gun's move multiplier for step(): its own pace, slower
// on the way into and inside a scope, and slower again while it cycles
// after a shot (cooldown left) if it has a fireSpeed.
export function moveFactor(a) {
  const w = WEAPONS[weaponOf(a)];
  return (w.speed ?? 1) * (w.scope && a.scope > 0 ? w.scope.speed : 1) * (a.cooldown > 0 ? w.fireSpeed ?? 1 : 1);
}

// The heat a shot fires with: the heat before it, so a first shot has none.
export const shotHeat = (a) => Math.max(0, a.heat - 1);

export const weaponOf = (a) => (a.slot === 0 ? a.primary : a.secondary);

// Everything a player's state holds at the moment they spawn. Server and
// client both build it here, so a new life starts identical on both sides.
export const freshLife = (x, y, z, primary, secondary) => ({
  mover: { ...createMover(x, y, z), grounded: true }, // spawns sit on a surface
  arsenal: createArsenal(primary, secondary),
  hp: MAX_HP,
  alive: true,
});

// Where a player's shot starts and which way it goes (yaw 0 faces -z).
export const eyeOf = (m) => [m.x, m.y + (m.crouch ? EYE_CROUCH : EYE_STAND), m.z];
export const aimDir = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

// Spread cone half-angle in degrees: blended from standing to moving by
// ground speed, doubled in the air, tightened when crouched; plus the
// spray's bloom for the heat the shot fires with. arsenal: scoped (scopedIn)
// swaps in a scoped gun's scope.spread and scope.moveSpread.
export function spreadDegrees(weapon, m, heat = 0, scoped = false) {
  const w = WEAPONS[weapon];
  const sc = scoped && w.scope;
  const stand = sc ? sc.spread : w.spreadStand;
  const move = sc ? sc.moveSpread : w.spreadMove;
  const bloom = Math.min(w.bloomMax ?? 0, (w.bloom ?? 0) * heat);
  if (!m.grounded) return SPREAD_AIR_FACTOR * move + bloom;
  if (m.crouch) return SPREAD_CROUCH_FACTOR * stand + bloom;
  const t = Math.min(1, Math.hypot(m.vx, m.vz) / RUN_SPEED);
  return stand + (move - stand) * t + bloom;
}

// The direction of each pellet (one for the rifle and pistol), spread
// uniformly over the cone by the shot's seeded generator.
export function shotDirs(yaw, pitch, weapon, m, rand, heat = 0, scoped = false) { // arsenal: scoped
  const fwd = aimDir(yaw, pitch);
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const cone = Math.tan((spreadDegrees(weapon, m, heat, scoped) * Math.PI) / 180);
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
  if (head && w.headDmg) return w.headDmg; // flat at any range, on every bullet
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
    a.reload = 0; // switching cancels a reload (a spray's heat stays, so a quick switch back is no cold tap)
  }
  if (a.switching > 1e-9) a.burst = 0; // arsenal: a switch or a power-up's gun lock ends a burst
  const w = WEAPONS[weaponOf(a)];
  a.heat = Math.max(0, a.heat - DT * HEAT_COOL); // only time cools a spray, whatever is held
  if (a.reload > 0) {
    a.reload -= DT;
    if (a.reload <= 1e-9) {
      // Shell-by-shell weapons load one at a time and keep going until full.
      a.mags[a.slot] = w.perShell ? a.mags[a.slot] + 1 : w.mag;
      a.reload = w.perShell && a.mags[a.slot] < w.mag ? w.reload : 0;
    }
  }
  // arsenal: a scoped gun scopes in while AIM is held, not while switching
  // or reloading; anything else drops the scope at once.
  const aimed = w.scope && input.keys & KEY.AIM && a.switching < 1e-9 && a.reload === 0;
  a.scope = aimed ? (a.scope + DT >= w.scope.inSeconds - 1e-9 ? w.scope.inSeconds : a.scope + DT) : 0; // snaps in, no float dust
  a.cooldown -= DT;
  let fired = false;
  // Automatic weapons fire while held; semi-automatic ones once per click;
  // arsenal: a burst gun starts a burst per click and finishes it unheld.
  const click = input.fire && !a.trigger;
  const pull = w.mode === 'auto' ? input.fire : click;
  const more = a.burst > 0; // arsenal: the burst under way fires on its own
  if (pull && w.perShell && a.reload > 0 && a.mags[a.slot] > 0) a.reload = 0; // a shot interrupts loading
  if ((pull || more) && a.switching < 1e-9 && a.reload === 0 && a.cooldown <= 0) {
    if (a.mags[a.slot] > 0) {
      a.mags[a.slot]--;
      if (w.mode === 'burst') {
        a.burst = (more ? a.burst : w.burst.count) - 1;
        a.cooldown += 1 / w.burst.rps + (a.burst ? 0 : w.burst.delay); // the delay follows a burst's last shot
      } else {
        a.cooldown += 1 / w.rps; // += keeps the remainder: 9.75/s is 6.15 steps
      }
      if (w.bloom) a.heat = Math.min(w.bloomMax / w.bloom + 1, a.heat + 1); // +1: shots read heat - 1; capped, so cooling starts at once
      fired = true;
    } else if (more) {
      a.burst = 0; // arsenal: dry mid-burst; the next click reloads
    } else {
      a.reload = w.reload; // pulling on an empty magazine reloads it
    }
  }
  // Without this clamp a released trigger would bank shots for a burst.
  if (!fired) a.cooldown = Math.max(a.cooldown, 0);
  if (input.keys & KEY.RELOAD && a.reload === 0 && a.mags[a.slot] < w.mag) a.reload = w.reload;
  if (a.reload > 0) a.burst = 0; // arsenal: a reload drops the rest of a burst
  a.trigger = input.fire;
  return fired;
}
