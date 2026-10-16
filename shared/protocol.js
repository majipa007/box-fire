// Wire format: JSON objects tagged by `t`. Client messages are validated
// here because they arrive from the network; server messages are trusted.
import { NAME_MAX, PRIMARIES, SECONDARIES, PITCH_LIMIT, MAPS } from './constants.js';
import { GUN_IDS } from './guns/index.js'; // arsenal

export const encode = (msg) => JSON.stringify(msg);

// A snapshot's public entry per player:
//   [id, x, y, z, yaw, pitch, flags, hp, weapon]
// flags are PLAYER_FLAGS bits; weapon indexes WEAPON_IDS. SHIELDED is spawn
// protection; BUBBLE (a power-up Shield), NITRO and SLOWED are power-up
// effects.
export const PLAYER_FLAGS = { CROUCH: 1, ALIVE: 2, SHIELDED: 4, BUBBLE: 8, NITRO: 16, SLOWED: 32 };
export const WEAPON_IDS = GUN_IDS; // arsenal: the registry order (shared/guns/index.js)

// POWER-UPS: ids on the wire (never part of WEAPON_IDS), and entity types.
export const POWER_IDS = ['shunt', 'bolt', 'barge', 'shock', 'mine', 'nitro', 'shield'];
export const ENT = { SHUNT: 0, MINE: 1, DOME: 2 };

// POWER-UPS: the wire format (docs/bible.md §4.5).
// - Use and cycle ride the input packet as the press-once bits KEY.USE and
//   KEY.CYCLE, so the server applies them at exactly the predicted step.
// - Snapshot `me.pw`: { inv, sel, cd, shield, shieldT, bolts, boltT }.
// - Snapshot `pu`: { pd: [[k, readyTick, spanTicks] per pad], en: [[eid,
//   type, owner, x, y, z, a, b], ...] }. k indexes POWER_IDS; readyTick 0 is
//   up. Shunt: a = target id (0 none). Mine: a = 0 arming, 1 armed, 2 fused.
//   Dome: a = strike tick, b = target id. type is an ENT value.
// - Events: pick { id, pad, k, tick }, use { id, k, x, y, z, tick }, boom
//   { k, x, y, z, r, id, eid, tick } (r 0 is a fizzle; id is the credited
//   player). hit adds w, sh (absorbed by a Shield), sx, sz (blast source);
//   kill's w and shot's w may be a power id.
export const PU_STATE = { ARMING: 0, ARMED: 1, FUSED: 2 };

// The engine wave's entity tuple, kept only as tested API; the `pu` rows
// above replaced it on the wire.
export const POWERUP_IDS = POWER_IDS;
export const ENTITY_FLAGS = { ARMED: 1 };
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
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
      // arsenal: an optional pick for the first life; an id not listed in its slot is dropped, never the join.
      return name && { t: 'join', name, bot: m.bot === true,
        ...(PRIMARIES.includes(m.primary) && { primary: m.primary }), ...(SECONDARIES.includes(m.secondary) && { secondary: m.secondary }) };
    }
    case 'start': return { t: 'start' };
    case 'end_match': return { t: 'end_match' };
    case 'loadout': {
      // arsenal: a primary, a sidearm or both; each named one must be a
      // listed id of its own slot (never a lookup on an untrusted key).
      const { primary, secondary } = m;
      if (primary === undefined && secondary === undefined) return null;
      if (primary !== undefined && !PRIMARIES.includes(primary)) return null;
      if (secondary !== undefined && !SECONDARIES.includes(secondary)) return null;
      return { t: 'loadout', ...(primary !== undefined && { primary }), ...(secondary !== undefined && { secondary }) };
    }
    case 'vote': return MAPS.includes(m.map) ? { t: 'vote', map: m.map } : null; // a listed id, never a path
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
