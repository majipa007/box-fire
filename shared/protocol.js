// Wire format: JSON objects tagged by `t`. Client messages are validated
// here because they arrive from the network; server messages are trusted.
import { NAME_MAX } from './constants.js';

export const encode = (msg) => JSON.stringify(msg);

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
    case 'input': {
      const { s, rt, k, y, p, n, w } = m;
      if (!uint(s) || !uint(n) || !uint(k) || k > 0xffff || (w !== 0 && w !== 1)) return null;
      if (!Number.isFinite(rt) || !Number.isFinite(y) || !Number.isFinite(p)) return null;
      return { t: 'input', s, rt, keys: k, yaw: y, pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p)), fire: !!m.f, shot: n, slot: w };
    }
    default: return null;
  }
}

const PITCH_LIMIT = (89 * Math.PI) / 180;
const uint = (v) => Number.isSafeInteger(v) && v >= 0;

// Client → server input packet, in short wire keys.
export const encodeInput = (i) => encode({ t: 'input', s: i.s, rt: i.rt, k: i.keys, y: i.yaw, p: i.pitch, f: i.fire ? 1 : 0, n: i.shot, w: i.slot });
