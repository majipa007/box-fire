// Power-ups, the shared part (docs/bible.md §4.4): the inventory step that
// the server, predict() and the reconcile replay all run once per input,
// after stepWeapon, plus the pure helpers the server uses. Numbers live in
// POWERS in constants.js; Nitro and Shock's slow live in the mover.
import {
  TICK_RATE, POWERS, POWER_USE_SECONDS, POWER_GUN_LOCK, POWER_BOLT_GUN_LOCK, POWER_RATE_PLAYERS,
  POWER_PAD_BOX, PLAYER_WIDTH, STAND_HEIGHT, CROUCH_HEIGHT, // powerups: padUnder
} from './constants.js';
import { KEY } from './movement.js';
import { rayBox } from './collision.js';

const ticks = (seconds) => Math.round(seconds * TICK_RATE);
export const USE_TICKS = ticks(POWER_USE_SECONDS); // 60
export const BOLT_GAP_TICKS = ticks(POWERS.bolt.gap); // 15
export const NITRO_TICKS = ticks(POWERS.nitro.seconds); // 240
export const SHIELD_TICKS = ticks(POWERS.shield.seconds); // 480
export const ARENA_LIMIT = 19.4; // m: Shock domes stay this far inside arena_01's walls

export const createPowers = () => ({ inv: [], sel: 0, cd: 0, shield: 0, shieldT: 0, bolts: 0, boltT: 0 });

// Returns 'shunt'|'barge'|'shock'|'mine'|'nitro'|'shield' on the step an item
// is used, 'bolt' on each of the 3 Bolt shots (the first on the use step),
// else null. Everything it touches is predicted state.
export function stepPowers(pw, mover, arsenal, input) {
  if (pw.cd > 0) pw.cd--;
  if (pw.shieldT > 0 && --pw.shieldT === 0) pw.shield = 0;
  if (input.keys & KEY.CYCLE && pw.inv.length > 1) pw.sel = (pw.sel + 1) % pw.inv.length;
  if (pw.bolts > 0 && --pw.boltT <= 0) {
    pw.bolts--;
    pw.boltT = BOLT_GAP_TICKS;
    return 'bolt';
  }
  if (!(input.keys & KEY.USE) || pw.cd > 0 || pw.bolts > 0 || !pw.inv.length) return null;
  const kind = pw.inv.splice(pw.sel, 1)[0];
  pw.sel = Math.min(pw.sel, Math.max(0, pw.inv.length - 1));
  pw.cd = USE_TICKS;
  arsenal.switching = Math.max(arsenal.switching, kind === 'bolt' ? POWER_BOLT_GUN_LOCK : POWER_GUN_LOCK);
  if (kind === 'nitro') mover.boost = NITRO_TICKS;
  if (kind === 'shield') {
    pw.shield = POWERS.shield.hp;
    pw.shieldT = SHIELD_TICKS;
  }
  if (kind === 'bolt') {
    pw.bolts = POWERS.bolt.shots - 1;
    pw.boltT = BOLT_GAP_TICKS;
  }
  return kind;
}

// Splash damage at distance d from a blast of radius r: max at the centre,
// min at the edge, nothing beyond.
export const falloff = (d, r, max, min) => (d >= r ? 0 : max - ((max - min) * d) / r);

// Knock and lift scale: 1 at the centre, 0.6 at the edge.
export const pushScale = (d, r) => 1 - (0.4 * d) / r;

// Where Shock's domes land: ahead of the target along its velocity, at its
// height, kept inside the arena.
export function domeCentres(x, y, z, vx, vz) {
  const { domes, lead, step } = POWERS.shock;
  const clamp = (v) => Math.max(-ARENA_LIMIT, Math.min(ARENA_LIMIT, v));
  return Array.from({ length: domes }, (_, i) => [clamp(x + vx * (lead + i * step)), y, clamp(z + vz * (lead + i * step))]);
}

// What a Shunt homes on: the chest, 1.0 m up (0.7 m crouched).
export const chestOf = (m) => [m.x, m.y + (m.crouch ? 0.7 : 1), m.z];

// Is the straight line from a to b free of map boxes?
export function clearLine(a, b, boxes) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (!len) return true;
  const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
  for (const box of boxes) if (rayBox(a, dir, box.min, box.max) < len) return false;
  return true;
}

// A Shunt's lock at launch: of the candidates ({ id, x, y, z, crouch }), the
// one with the smallest angle to dir within the cone and range, in sight.
export function lockTarget(eye, dir, candidates, boxes) {
  const { cone, range } = POWERS.shunt;
  let best = null;
  let bestCos = Math.cos((cone * Math.PI) / 180);
  for (const c of candidates) {
    const chest = chestOf(c);
    const d = Math.hypot(chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]);
    if (!d || d > range) continue;
    const cos = ((chest[0] - eye[0]) * dir[0] + (chest[1] - eye[1]) * dir[1] + (chest[2] - eye[2]) * dir[2]) / d;
    if (cos >= bestCos && clearLine(eye, chest, boxes)) {
      best = c.id;
      bestCos = cos;
    }
  }
  return best;
}

// Ticks until a pad refills: slower in small games, so the per-player rate
// stays near the 6-player one, but never more than 3x slower (the user's
// call: 60–90 s with 1 player, not 2–3 min).
export const padRespawnTicks = (pad, n) => Math.round(pad.respawn * TICK_RATE * Math.min(3, Math.max(1, POWER_RATE_PLAYERS / Math.max(1, n))));

// powerups: the index of the pad whose pickup box a mover ({ x, y, z, crouch })
// stands in, else -1. The server's overlaps() rule without its allocations,
// for the client's per-frame pad cue.
const PAD_REACH_X = POWER_PAD_BOX[0] / 2 + PLAYER_WIDTH / 2;
const PAD_REACH_Z = POWER_PAD_BOX[2] / 2 + PLAYER_WIDTH / 2;
export function padUnder(m, pads) {
  const h = m.crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (Math.abs(m.x - p.x) < PAD_REACH_X && Math.abs(m.z - p.z) < PAD_REACH_Z && m.y < p.y + POWER_PAD_BOX[1] && m.y + h > p.y) return i;
  }
  return -1;
}
