// Bots: join the host as players and play through the real input pipeline.
// They see only foes in view with a clear line of sight, hear shots and feel
// hits, fight with human-like aim at their skill, take cover when hurt, hunt,
// collect power-up pads and use what they hold (tools/bot/brain.js). Each
// life a bot carries a random primary and sidearm from the gun registry. --skill mixed (the default) rolls easy, normal
// or hard for each bot. --passive bots never shoot or use
// an offensive power-up: they wander and collect pads, a harmless target for
// visual checks and netcode tests. --loadout primary,sidearm fixes every
// bot's guns for every life (live checks of one gun). Up to MAX_PLAYERS minus the humans.
//   npm run bot -- --count 6 [--skill easy|normal|hard|mixed] [--passive] [--loadout lmg,handcannon] [--url ws://localhost:3000]
import { encodeInput } from '../shared/protocol.js';
import { TICK_RATE, PORT, PRIMARIES, SECONDARIES } from '../shared/constants.js';
import { SKILLS } from './bot/aim.js';
import { createBot, onMessage, think } from './bot/brain.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const count = Number(opt('count', 1));
const skill = opt('skill', 'mixed');
const passive = args.includes('--passive');
const url = opt('url', `ws://localhost:${process.env.PORT || PORT}`);
if (skill !== 'mixed' && !SKILLS[skill]) {
  console.log(`--skill ${skill}: use easy, normal, hard or mixed`);
  process.exit(1);
}
const [primary, secondary] = opt('loadout', '').split(',');
if (primary && !(PRIMARIES.includes(primary) && SECONDARIES.includes(secondary))) {
  console.log(`--loadout ${primary},${secondary}: a primary (${PRIMARIES}) and a sidearm (${SECONDARIES})`);
  process.exit(1);
}

function startBot(n) {
  const bot = createBot(n, { skill: skill === 'mixed' ? Object.keys(SKILLS)[Math.floor(Math.random() * 3)] : skill, passive, primary: primary || undefined, secondary });
  const ws = new WebSocket(url);
  bot.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'join', name: `bot${n}`, bot: true }));
    flush(bot); // arsenal: the first loadout
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'reject') {
      console.log(`bot${n}: rejected (${m.reason})`);
      ws.close();
    } else onMessage(bot, m);
  };
  ws.onerror = () => console.log(`bot${n}: cannot reach ${url}`);
  console.log(`bot${n}: ${passive ? 'passive' : bot.skill}, ${bot.primary} + ${bot.secondary}`);
  return bot;
}

// arsenal: messages the brain queued (a loadout for the next life).
function flush(bot) {
  while (bot.out.length) bot.ws.send(JSON.stringify(bot.out.shift()));
}

const bots = Array.from({ length: count }, (_, i) => startBot(i + 1));
console.log(`${count} bot(s) joining ${url}. Ctrl+C to stop.`);

// One timer for every bot: one input per 60 Hz step on the wall clock, and
// at most 3 route plans per step across all of them.
const start = performance.now();
const budget = { plans: 3 };
let steps = 0, work = 0, worst = 0, ticks = 0;
setInterval(() => {
  const due = Math.floor((performance.now() - start) / (1000 / TICK_RATE));
  for (; steps < due; steps++) {
    budget.plans = 3;
    const t0 = performance.now();
    for (const bot of bots) {
      if (bot.ws.readyState === WebSocket.OPEN) flush(bot); // arsenal
      if (bot.spawned && bot.ws.readyState === WebSocket.OPEN) bot.ws.send(encodeInput(think(bot, budget)));
    }
    const t = performance.now() - t0;
    work += t; worst = Math.max(worst, t); ticks++;
  }
  if (ticks >= 10 * TICK_RATE) {
    console.log(`ai: ${(work / ticks).toFixed(3)} ms/tick avg, ${worst.toFixed(2)} ms max`);
    work = worst = ticks = 0;
  }
  if (bots.every((b) => b.ws.readyState === WebSocket.CLOSED)) process.exit(0);
}, 8);
