// Wire format: JSON objects tagged by `t`. Client messages are validated
// here because they arrive from the network; server messages are trusted.
import { NAME_MAX, PRIMARIES, PITCH_LIMIT, POWERUPS } from './constants.js';

export const encode = (msg) => JSON.stringify(msg);

// A snapshot's public entry per player:
//   [id, x, y, z, yaw, pitch, flags, hp, weapon]
// flags are PLAYER_FLAGS bits; weapon indexes WEAPON_IDS. SHIELDED is spawn
// protection; PU_NITRO and PU_SHIELD are active power-ups (powerups).
export const PLAYER_FLAGS = { CROUCH: 1, ALIVE: 2, SHIELDED: 4, PU_NITRO: 8, PU_SHIELD: 16 };
export const WEAPON_IDS = ['rifle', 'pistol', 'shotgun'];

// powerups: the power-up wire format.
// - Use and cycle are not a message of their own: they ride the input packet
//   as the press-once key bits KEY.USE and KEY.CYCLE, so the server applies
//   them at exactly the step the client predicted (Nitro moves at once), in
//   order with movement, and they survive the overflow drop like a click.
// - The snapshot's `me` adds inv (kinds, first is next to fire) and shield
//   (damage it still soaks). Its `pu` holds pads (per pad of the map, 0 when
//   ready, else the tick it refills) and ents (entityTuple per Shunt, Bolt
//   and Mine).
// - Events: pickup { id, pad, k }; powerup { id, k, x, y, z } when one is
//   used; blast { k, x, y, z } when a Shunt, Bolt, Mine or Barge goes off.
//   Kills by power-ups carry the kind as their weapon `w`.
export const POWERUP_IDS = Object.keys(POWERUPS);
export const ENTITY_FLAGS = { ARMED: 1 };
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
// [id, kind, owner, x, y, z, vx, vy, vz, flags]: kind indexes POWERUP_IDS.
export const entityTuple = (e) => [e.id, POWERUP_IDS.indexOf(e.kind), e.owner, r2(e.x), r2(e.y), r2(e.z), r1(e.vx), r1(e.vy), r1(e.vz), e.armed ? ENTITY_FLAGS.ARMED : 0];
export const readEntity = ([id, k, owner, x, y, z, vx, vy, vz, f]) => ({ id, kind: POWERUP_IDS[k], owner, x, y, z, vx, vy, vz, armed: !!(f & ENTITY_FLAGS.ARMED) });

// The one ranking of a lobby list: most kills, then fewest deaths. Used for
// the winner, the scoreboard and the HUD leader alike.
export const byScore = (a, b) => b.kills - a.kills || a.deaths - b.deaths;

// Display names: trimmed, 1..NAME_MAX characters, no control characters.
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const s = name.trim();
  return s.length >= 1 && s.length <= NAME_MAX && !/[\u0000-\u001f\u007f]/.test(s) ? s : null;
}

// Parse and validate a client → server message. Anything malformed is null.
export function decodeClient(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  switch (m.t) {
    case 'join': {
      const name = cleanName(m.name);
      return name && { t: 'join', name, bot: m.bot === true };
    }
    case 'start': return { t: 'start' };
    case 'end_match': return { t: 'end_match' };
    case 'loadout': return PRIMARIES.includes(m.primary) ? { t: 'loadout', primary: m.primary } : null;
    case 'input': {
      const { s, rt, k, y, p, n, w } = m;
      if (!uint(s) || !uint(n) || !uint(k) || k > 0xffff || (w !== 0 && w !== 1)) return null;
      if (!Number.isFinite(rt) || !Number.isFinite(y) || !Number.isFinite(p)) return null;
      return { t: 'input', s, rt, keys: k, yaw: y, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p)), fire: !!m.f, shot: n, slot: w };
    }
    default: return null;
  }
}

const uint = (v) => Number.isSafeInteger(v) && v >= 0;

// Client → server input packet, in short wire keys.
export const encodeInput = (i) => encode({ t: 'input', s: i.s, rt: i.rt, k: i.keys, y: i.yaw, p: i.pitch, f: i.fire ? 1 : 0, n: i.shot, w: i.slot });
