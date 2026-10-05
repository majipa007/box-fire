// WebSocket to the host that served this page. Messages are dispatched to
// handlers by their `t` tag.
import { encode } from '../shared/protocol.js';

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
      const data = encode(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
      else if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.send(data), { once: true });
    },
  };
}
