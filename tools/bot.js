// Test bots: join the host as players and play through the real input
// pipeline. They strafe and hop, run to power-up pads while they have room,
// and use what they hold when it makes sense: Shunt and Bolt at an enemy in
// sight, Barge up close, Shield when hurt or under fire, Nitro for a long
// run, Mines where they stand, Shock right away. They never fire guns.
//   npm run bot -- --count 8 [--url ws://localhost:3000]
import { readFileSync } from 'node:fs';
import { KEY } from '../shared/movement.js';
import { encodeInput, PLAYER_FLAGS } from '../shared/protocol.js';
import { prepareMap } from '../shared/collision.js';
import { chestOf, clearLine } from '../shared/powerups.js';
import { TICK_RATE, PORT, INTERP_DELAY_TICKS, POWER_PADS, POWER_CAPACITY, MAX_HP } from '../shared/constants.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const count = Number(opt('count', 1));
const url = opt('url', `ws://localhost:${process.env.PORT || PORT}`);
const maps = new Map(); // map id → prepared boxes
const boxesOf = (id) => {
  if (!maps.has(id)) maps.set(id, prepareMap(JSON.parse(readFileSync(new URL(`../shared/maps/${id}.json`, import.meta.url)))).boxes);
  return maps.get(id);
};

function startBot(n) {
  const ws = new WebSocket(url);
  const bot = { n, ws, id: null, tick: 0, spawned: false, yaw: 0, pitch: 0, seq: 0, boxes: [], me: null, ps: [], pd: [], stuck: 0, dodge: 0, last: null, holdAim: 0 };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: `bot${n}`, bot: true }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      bot.id = m.id;
      bot.boxes = boxesOf(m.map);
    } else if (m.t === 'snapshot') {
      bot.tick = m.tick;
      bot.me = m.me;
      bot.ps = m.ps;
      bot.pd = m.pu?.pd ?? [];
    } else if (m.t === 'event' && m.e === 'spawn' && m.id === bot.id) {
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

const angleTo = (from, to) => [Math.atan2(-(to[0] - from[0]), -(to[2] - from[2])), Math.atan2(to[1] - from[1], Math.hypot(to[0] - from[0], to[2] - from[2]))];

// The nearest living enemy in sight: { pos, chest, dist } or null.
function nearestFoe(bot, eye) {
  let best = null;
  for (const [id, x, y, z, , , flags] of bot.ps) {
    if (id === bot.id || !(flags & PLAYER_FLAGS.ALIVE)) continue;
    const chest = chestOf({ x, y, z, crouch: !!(flags & PLAYER_FLAGS.CROUCH) });
    const dist = Math.hypot(chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]);
    if ((!best || dist < best.dist) && clearLine(eye, chest, bot.boxes)) best = { chest, dist };
  }
  return best;
}

// Should the bot use `kind` now? The foe is the nearest enemy in sight.
function wants(kind, bot, foe, padDist) {
  const m = bot.me;
  switch (kind) {
    case 'shunt': return foe && foe.dist < 35;
    case 'bolt': return foe && foe.dist < 30;
    case 'barge': return foe && foe.dist < 4;
    case 'shield': return m.hp < MAX_HP || (foe && foe.dist < 15);
    case 'nitro': return padDist > 12;
    case 'mine': return Math.random() < 0.01;
    case 'shock': return true;
    default: return false;
  }
}

function input(bot, i) {
  const m = bot.me?.mover;
  let keys = 0;
  if (!m || !bot.me.alive) return { s: ++bot.seq, rt: bot.tick - INTERP_DELAY_TICKS, keys, yaw: bot.yaw, pitch: 0, fire: false, shot: 0, slot: 0 };
  const pw = bot.me.pw;
  const eye = [m.x, m.y + 1.6, m.z];
  // Go for the nearest pad that is up while there is room; else wander.
  let pad = null;
  let padDist = Infinity;
  if (pw && pw.inv.length < POWER_CAPACITY) {
    POWER_PADS.forEach(({ pos }, k) => {
      const d = Math.hypot(pos[0] - m.x, pos[2] - m.z);
      if (bot.pd[k] && !bot.pd[k][1] && d < padDist) [pad, padDist] = [pos, d];
    });
  }
  // Stuck against something: sidestep and hop for a moment.
  const moved = bot.last ? Math.hypot(m.x - bot.last[0], m.z - bot.last[1]) : 1;
  bot.last = [m.x, m.z];
  bot.stuck = moved < 0.02 ? bot.stuck + 1 : 0;
  if (bot.stuck > 20) bot.dodge = 40 + Math.floor(Math.random() * 40);
  if (pad && bot.dodge <= 0) {
    [bot.yaw] = angleTo([m.x, m.y, m.z], pad);
    keys |= KEY.FORWARD;
  } else {
    const phase = Math.floor((i + bot.n * 17) / TICK_RATE) % 2;
    keys |= phase ? KEY.LEFT : KEY.RIGHT;
    if (!pad) bot.yaw += 0.004;
    else keys |= KEY.FORWARD;
  }
  if (bot.dodge > 0) {
    bot.dodge--;
    keys |= (bot.n % 2 ? KEY.LEFT : KEY.RIGHT) | (bot.dodge % 30 === 0 ? KEY.JUMP : 0);
  }
  if ((i + bot.n * 29) % (2 * TICK_RATE) === 0) keys |= KEY.JUMP;
  // Power-ups: look at a foe in sight, then use the selected item if it fits
  // the moment, or select the next one that does.
  const foe = nearestFoe(bot, eye);
  let aim = bot.holdAim > 0;
  if (aim) bot.holdAim--;
  if (pw && pw.inv.length && !pw.cd && !pw.bolts && i % 6 === bot.n % 6) {
    const kind = pw.inv[pw.sel];
    if (wants(kind, bot, foe, padDist)) {
      keys |= KEY.USE;
      aim ||= kind === 'shunt' || kind === 'bolt';
      if (kind === 'bolt') bot.holdAim = 40; // all three shots
    } else if (pw.inv.some((k) => wants(k, bot, foe, padDist))) keys |= KEY.CYCLE;
  }
  const [yaw, pitch] = aim && foe ? angleTo(eye, foe.chest) : [bot.yaw, 0];
  return { s: ++bot.seq, rt: bot.tick - INTERP_DELAY_TICKS, keys, yaw, pitch, fire: false, shot: 0, slot: 0 };
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
