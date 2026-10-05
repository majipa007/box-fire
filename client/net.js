// WebSocket to the host that served this page, plus own-player prediction.
import { encode } from '../shared/protocol.js';
import { step } from '../shared/movement.js';

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
