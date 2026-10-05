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
    default: return null;
  }
}
