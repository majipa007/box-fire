// WebSocket to the host that served this page, own-player prediction, and
// the snapshot buffer other players are interpolated from.
import { encode } from '../shared/protocol.js';
import { step } from '../shared/movement.js';
import { TICK_RATE, INTERP_DELAY_TICKS } from '../shared/constants.js';

const STEP_MS = 1000 / TICK_RATE;

// Messages are dispatched to handlers by their `t` tag.
export function connect(handlers) {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handlers[m.t]?.(m);
  };
  ws.onclose = () => handlers.close?.();
  return {
    send(msg) {
      const data = typeof msg === 'string' ? msg : encode(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
      else if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.send(data), { once: true });
    },
  };
}

// Prediction: each input moves the local player at once and is kept until
// the server acknowledges it. Each snapshot snaps to the server's state and
// replays what the server has not seen yet. Look angles are never touched:
// the camera belongs to the client.
export const self = { mover: null, pending: [], seq: 0 };

export function predict(input, boxes) {
  input.s = ++self.seq;
  step(self.mover, input, boxes);
  self.pending.push(input);
  if (self.pending.length > 120) self.pending.shift(); // the server stopped acking
}

export function reconcile(snapshot, boxes) {
  if (!self.mover || !snapshot.me) return;
  Object.assign(self.mover, snapshot.me);
  self.pending = self.pending.filter((i) => i.s > snapshot.ack);
  for (const i of self.pending) step(self.mover, i, boxes);
}

// Other players are drawn INTERP_DELAY_TICKS behind the server's current
// tick, between the two buffered snapshots around that moment. When the
// buffer runs dry they freeze on the newest one; never extrapolate, because
// a guessed position never existed on the server and rewound shots at it
// would miss.
const buffer = []; // { tick, ps }, oldest first
let clockBase = null; // performance.now() of server tick 0, smoothed

export function bufferSnapshot(m, now) {
  buffer.push({ tick: m.tick, ps: m.ps });
  if (buffer.length > 60) buffer.shift();
  const base = now - m.tick * STEP_MS;
  clockBase = clockBase === null || Math.abs(base - clockBase) > 250 ? base : clockBase + (base - clockBase) * 0.05;
}

// The (fractional) server tick other players are being drawn at.
export const renderTick = (now) => (clockBase === null ? 0 : (now - clockBase) / STEP_MS - INTERP_DELAY_TICKS);

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// [{ id, x, y, z, yaw, pitch, crouch }] at the render tick.
export function others(now) {
  if (!buffer.length) return [];
  const rt = renderTick(now);
  let i = buffer.length - 1;
  while (i > 0 && buffer[i - 1].tick > rt) i--;
  const b = buffer[i];
  const a = i > 0 && buffer[i - 1].tick <= rt ? buffer[i - 1] : b;
  const t = a === b ? 0 : Math.min(1, (rt - a.tick) / (b.tick - a.tick));
  const from = new Map(a.ps.map((p) => [p[0], p]));
  return b.ps.map(([id, x, y, z, yaw, pitch, flags]) => {
    const p = from.get(id);
    // Respawns and joins snap rather than streak across the map.
    if (!p || Math.hypot(p[1] - x, p[3] - z) > 2) return { id, x, y, z, yaw, pitch, crouch: !!(flags & 1) };
    return {
      id,
      x: lerp(p[1], x, t), y: lerp(p[2], y, t), z: lerp(p[3], z, t),
      yaw: lerpAngle(p[4], yaw, t), pitch: lerp(p[5], pitch, t),
      crouch: !!((t < 0.5 ? p[6] : flags) & 1),
    };
  });
}
