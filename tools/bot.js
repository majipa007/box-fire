// Test bots: join the host as players and strafe and jump through the real
// input pipeline. They only send inputs; the server moves them.
//   npm run bot -- --count 8 [--url ws://localhost:3000]
import { KEY } from '../shared/movement.js';
import { encodeInput } from '../shared/protocol.js';
import { TICK_RATE, PORT } from '../shared/constants.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const count = Number(opt('count', 1));
const url = opt('url', `ws://localhost:${process.env.PORT || PORT}`);

function startBot(n) {
  const ws = new WebSocket(url);
  const bot = { n, ws, id: null, tick: 0, spawned: false, yaw: 0, seq: 0 };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: `bot${n}`, bot: true }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') bot.id = m.id;
    else if (m.t === 'snapshot') bot.tick = m.tick;
    else if (m.t === 'event' && m.e === 'spawn' && m.id === bot.id) {
      bot.spawned = true;
      bot.yaw = m.yaw;
    } else if (m.t === 'reject') {
      console.log(`bot${n}: rejected (${m.reason})`);
      ws.close();
    }
  };
  ws.onerror = () => console.log(`bot${n}: cannot reach ${url}`);
  return bot;
}

// Strafe left and right each second, hop every two, turn slowly.
function input(bot, i) {
  const phase = Math.floor((i + bot.n * 17) / TICK_RATE) % 2;
  const keys = (phase ? KEY.LEFT : KEY.RIGHT) | ((i + bot.n * 29) % (2 * TICK_RATE) === 0 ? KEY.JUMP : 0);
  bot.yaw += 0.004;
  return { s: ++bot.seq, rt: bot.tick - 2, keys, yaw: bot.yaw, pitch: 0, fire: false, shot: 0, slot: 0 };
}

const bots = Array.from({ length: count }, (_, i) => startBot(i + 1));
console.log(`${count} bot(s) joining ${url}. Ctrl+C to stop.`);

// One timer for every bot: one input per 60 Hz step on the wall clock.
const start = performance.now();
let steps = 0;
setInterval(() => {
  const due = Math.floor((performance.now() - start) / (1000 / TICK_RATE));
  for (; steps < due; steps++) {
    for (const bot of bots) {
      if (bot.spawned && bot.ws.readyState === WebSocket.OPEN) bot.ws.send(encodeInput(input(bot, steps)));
    }
  }
  if (bots.every((b) => b.ws.readyState === WebSocket.CLOSED)) process.exit(0);
}, 8);
