// A bot's mind: server messages in (onMessage), one input per tick out
// (think). Pure apart from `rand`, which is injected. Fair by construction:
// perceive() is the only code that reads other players' positions, and it
// only keeps foes in view (field of view, or close enough to notice) with a
// clear line of sight. Shots are heard and hits felt, both with noise.
import { KEY } from '../../shared/movement.js';
import { PLAYER_FLAGS } from '../../shared/protocol.js';
import { clearLine } from '../../shared/powerups.js';
import { eyeOf, weaponOf, spreadDegrees } from '../../shared/weapons.js';
import { TICK_RATE, DT, POWER_CAPACITY, MAX_HP, WEAPONS, RUN_SPEED } from '../../shared/constants.js';
import { navFor, createRoute, follow, floorReachable } from './nav.js';
import { SKILLS, createAim, acquire, stepAim, shouldFire, standsToShoot, idealRange, roleOf, yawTo } from './aim.js';

const { ALIVE, CROUCH, SHIELDED, BUBBLE } = PLAYER_FLAGS;
const D2R = Math.PI / 180;
const HIST = 32; // ticks of sightings kept per foe, for lagged aim
const THINK = 12; // ticks between goal choices: 5 Hz
const PATIENCE = [2, 8]; // s a refilled pad is left alone, unless within 6 m
// Looking where it walks: steady, no flick, no reaction to wait for.
const LOOK = Object.fromEntries(Object.entries(SKILLS).map(([k, sk]) => [k, { ...sk, wobble: 0.01, flick: 0, react: 0 }]));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Scratch points, reused every tick.
const HEAD = [0, 0, 0], CHEST = [0, 0, 0], SEEN = [0, 0, 0], PT = [0, 0, 0];

export function createBot(n, { skill = 'normal', passive = false, primary = 'rifle', rand = Math.random } = {}) {
  return {
    n, skill, sk: SKILLS[skill], passive, primary, rand,
    id: null, nav: null, tick: 0, me: null, ps: [], pd: [], players: [], spawned: false, seq: 0,
    aim: createAim(), target: null, goal: null, nextThink: n % THINK, route: createRoute(),
    mem: new Map(), hist: new Map(), noise: { x: 0, y: 0, z: 0, tick: -1e9 }, fresh: false,
    vis: Array.from({ length: 16 }, () => ({ id: 0, d: 0, prot: false, bubble: false, hp: 0 })), nvis: 0,
    padWait: new Map(), strafe: 1, flipAt: 0, hurtTick: -1e9, pickTick: -1e9, shockAt: null,
    input: { s: 0, rt: 0, keys: 0, yaw: 0, pitch: 0, fire: false, shot: 0, slot: 0 },
  };
}

// A map id from welcome or lobby. Unlisted ids are ignored. A new map clears
// everything tied to the old one, but not the spawn: on a map switch the
// spawn event arrives before the lobby message naming the map.
function setMap(bot, id) {
  const nav = navFor(id);
  if (!nav || nav === bot.nav) return;
  bot.nav = nav;
  bot.mem.clear(); bot.hist.clear(); bot.padWait.clear();
  bot.route = createRoute();
  bot.goal = null; bot.target = null; bot.noise.tick = -1e9;
}

export function onMessage(bot, m) {
  if (m.t === 'welcome') { bot.id = m.id; setMap(bot, m.map); }
  else if (m.t === 'lobby') { if (m.map) setMap(bot, m.map); bot.players = m.players ?? bot.players; }
  else if (m.t === 'snapshot') { bot.tick = m.tick; bot.me = m.me; bot.ps = m.ps; bot.pd = m.pu?.pd ?? []; }
  else if (m.t === 'event') onEvent(bot, m);
}

function onEvent(bot, e) {
  const me = bot.me?.mover, rand = bot.rand;
  if (e.e === 'spawn' && e.id === bot.id) {
    bot.spawned = true;
    bot.aim = createAim(e.yaw, 0);
    bot.goal = null; bot.target = null; bot.route = createRoute();
    bot.mem.clear(); bot.hist.clear();
  } else if (e.e === 'shot' && e.id !== bot.id && e.o && me) {
    // Heard: the shooter's position, rougher the further away.
    const d = Math.hypot(e.o[0] - me.x, e.o[2] - me.z);
    if (d < bot.sk.hear) noise(bot, e.o[0], e.o[1] - 1.6, e.o[2], Math.max(0.5, 0.1 * d));
  } else if (e.e === 'hit' && e.v === bot.id && e.a !== bot.id && me) {
    // Felt: a bearing within 20 degrees, at a range guessed within 20%.
    bot.hurtTick = bot.tick;
    const a = bot.ps.find((p) => p[0] === e.a);
    if (a && !bot.mem.has(e.a)) {
      const d = Math.hypot(a[1] - me.x, a[3] - me.z) * (1 + (rand() * 2 - 1) * 0.2);
      const yaw = yawTo(a[1] - me.x, a[3] - me.z) + (rand() * 2 - 1) * 20 * D2R;
      noise(bot, me.x - Math.sin(yaw) * d, me.y, me.z - Math.cos(yaw) * d, 0);
    }
  } else if (e.e === 'kill') {
    bot.mem.delete(e.v);
  } else if (e.e === 'pick' && e.id === bot.id) bot.pickTick = bot.tick;
}

function noise(bot, x, y, z, sigma) {
  const g = () => Math.sqrt(-2 * Math.log(1 - bot.rand())) * Math.cos(2 * Math.PI * bot.rand());
  Object.assign(bot.noise, { x: x + g() * sigma, y, z: z + g() * sigma, tick: bot.tick });
}

// Foes in view with a clear line, into bot.vis; remembers where each was.
function perceive(bot, eye) {
  const sk = bot.sk, boxes = bot.nav.map.boxes, half = (sk.fov / 2) * D2R;
  bot.nvis = 0;
  bot.fresh = false;
  for (const p of bot.ps) {
    const id = p[0], x = p[1], y = p[2], z = p[3], flags = p[6];
    if (id === bot.id || !(flags & ALIVE) || bot.nvis === bot.vis.length) continue;
    const crouch = !!(flags & CROUCH), dx = x - eye[0], dz = z - eye[2], d = Math.hypot(dx, dz);
    if (Math.abs(wrap(yawTo(dx, dz) - bot.aim.yaw)) > half && d > sk.notice) continue;
    HEAD[0] = CHEST[0] = x; HEAD[2] = CHEST[2] = z;
    HEAD[1] = y + (crouch ? 1.05 : 1.65); CHEST[1] = y + (crouch ? 0.7 : 1);
    if (!clearLine(eye, HEAD, boxes) && !clearLine(eye, CHEST, boxes)) continue;
    let mem = bot.mem.get(id);
    if (!mem) bot.mem.set(id, (mem = { x, y, z, tick: -1e9, prot: false, bubble: false, hp: 0, crouch }));
    if (bot.tick - mem.tick > 30) bot.fresh = true; // newly in sight
    mem.x = x; mem.y = y; mem.z = z; mem.tick = bot.tick; mem.hp = p[7]; mem.crouch = crouch;
    mem.prot = !!(flags & SHIELDED); mem.bubble = !!(flags & BUBBLE);
    let h = bot.hist.get(id);
    if (!h) bot.hist.set(id, (h = { n: 0, buf: new Float64Array(HIST * 4) }));
    const k = (h.n++ % HIST) * 4;
    h.buf[k] = bot.tick; h.buf[k + 1] = x; h.buf[k + 2] = y; h.buf[k + 3] = z;
    const v = bot.vis[bot.nvis++];
    v.id = id; v.d = d; v.prot = mem.prot; v.bubble = mem.bubble; v.hp = mem.hp;
  }
  for (const [id, mem] of bot.mem) if (bot.tick - mem.tick > sk.memory * TICK_RATE) bot.mem.delete(id);
}

// The target as this bot perceives it, into SEEN: where it was `lag` ago,
// led by a share of the velocity it saw, at the head or chest.
function seenPoint(bot, id, mem) {
  const sk = bot.sk, h = bot.hist.get(id), lagT = Math.round(sk.lag * TICK_RATE);
  const oldest = Math.max(0, h.n - HIST), buf = h.buf;
  const a = (Math.max(h.n - 1 - lagT, oldest) % HIST) * 4, b = (Math.max(h.n - 7 - lagT, oldest) % HIST) * 4;
  const dt = Math.max(1, buf[a] - buf[b]) * DT, lead = sk.lead * sk.lag;
  SEEN[0] = buf[a + 1] + ((buf[a + 1] - buf[b + 1]) / dt) * lead;
  SEEN[1] = buf[a + 2] + (mem.crouch ? (bot.aim.head ? 1.05 : 0.7) : bot.aim.head ? 1.65 : 1.0);
  SEEN[2] = buf[a + 3] + ((buf[a + 3] - buf[b + 3]) / dt) * lead;
  return SEEN;
}

// Utility choice at 5 Hz: fight, cover, hunt, pad or roam. The current goal
// gets a bonus so bots do not flip-flop; roaming does not, since it is only
// the fallback.
function choose(bot, m, ars) {
  const sk = bot.sk, t = bot.tick, cur = bot.goal?.kind;
  let best = null;
  const offer = (g) => { if (g.kind === cur && cur !== 'roam') g.s += 0.15; if (!best || g.s > best.s) best = g; };
  if (!bot.passive) {
    let target = null, score = Infinity, shootable = 0;
    for (let i = 0; i < bot.nvis; i++) {
      const v = bot.vis[i];
      if (v.prot) continue; // spawn protection: no point shooting
      shootable++;
      const s = v.d + (v.bubble ? 10 : 0) + v.hp / 20;
      if (s < score) { score = s; target = v.id; }
    }
    if (target !== null) offer({ kind: 'fight', id: target, s: shootable > 1 ? 0.8 : 0.9 });
    const hpShare = bot.me.hp / MAX_HP;
    // Hurt, or the primary empty: break line of sight.
    const spot = bot.nvis && (hpShare < 0.4 || (ars.slot === 0 && ars.mags[0] === 0)) ? coverSpot(bot, m) : null;
    if (spot) offer({ kind: 'cover', s: 1.2 - 0.5 * hpShare, pos: spot });
    let lost = null;
    for (const mem of bot.mem.values()) if (t - mem.tick > 20 && (!lost || mem.tick > lost.tick)) lost = mem;
    if (lost) offer({ kind: 'hunt', s: 0.6 * (1 - (t - lost.tick) / (sk.memory * TICK_RATE)), pos: [lost.x, lost.y, lost.z] });
    if (t - bot.noise.tick < 4 * TICK_RATE) offer({ kind: 'hunt', s: 0.5, pos: [bot.noise.x, bot.noise.y, bot.noise.z] });
  }
  const inv = bot.me.pw?.inv.length ?? POWER_CAPACITY;
  bot.nav.map.pads.forEach((pad, k) => {
    if (!bot.pd[k] || bot.pd[k][1]) { bot.padWait.delete(k); return; } // refilling
    if (!bot.padWait.has(k)) bot.padWait.set(k, t + Math.round((PATIENCE[0] + (PATIENCE[1] - PATIENCE[0]) * bot.rand()) * TICK_RATE));
    if (inv >= POWER_CAPACITY) return;
    const d = Math.hypot(pad.pos[0] - m.x, pad.pos[2] - m.z);
    if (t >= bot.padWait.get(k) || d < 6) offer({ kind: 'pad', s: 0.45 * (1 - inv / POWER_CAPACITY) * (1 - d / 50), pos: pad.pos });
  });
  if (cur === 'roam' && t < bot.goal.until) offer({ ...bot.goal, s: 0.2 });
  else { const s = bot.nav.map.spawns; offer({ kind: 'roam', s: 0.2, pos: s[Math.floor(bot.rand() * s.length)], until: t + 8 * TICK_RATE }); }
  return best;
}

// The nearest of 16 spots on 2, 4 and 6 m rings that the bot can walk to in
// a straight line and that no foe seen in the last 3 s can see.
function coverSpot(bot, m) {
  let best = null, bd = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI + bot.rand() * 0.3, r = 2 + (k % 3) * 2;
    const x = m.x + Math.sin(a) * r, z = m.z + Math.cos(a) * r;
    const y = floorReachable(bot.nav, m.x, bot.route.gy ?? m.y, m.z, x, z);
    if (y === null || r >= bd) continue;
    let hidden = true;
    for (const t of bot.mem.values()) {
      if (bot.tick - t.tick < 3 * TICK_RATE && clearLine([t.x, t.y + 1.6, t.z], [x, y + 1, z], bot.nav.map.boxes)) { hidden = false; break; }
    }
    if (hidden) { best = [x, y, z]; bd = r; }
  }
  return best;
}

// Keys that move along world direction (dx, dz) while looking along yaw.
const OCT = [KEY.FORWARD, KEY.FORWARD | KEY.LEFT, KEY.LEFT, KEY.BACK | KEY.LEFT, KEY.BACK, KEY.BACK | KEY.RIGHT, KEY.RIGHT, KEY.FORWARD | KEY.RIGHT];
function moveKeys(yaw, dx, dz) {
  if (Math.hypot(dx, dz) < 1e-3) return 0;
  return OCT[((Math.round((yawTo(dx, dz) - yaw) / (Math.PI / 4)) % 8) + 8) % 8];
}

// One input for this tick. budget.plans caps A* plans across all bots.
export function think(bot, budget) {
  const inp = bot.input, st = bot.me, a = bot.aim, rand = bot.rand;
  inp.s = ++bot.seq; inp.shot = bot.seq; inp.rt = bot.tick; // history is recorded before the snapshot goes out
  inp.keys = 0; inp.fire = false; inp.slot = st?.arsenal?.slot ?? 0;
  inp.yaw = a.yaw; inp.pitch = a.pitch;
  if (!bot.spawned || !st?.alive || !st.mover || !bot.nav) return inp;
  const m = st.mover, sk = bot.sk, ars = st.arsenal, wname = weaponOf(ars), w = WEAPONS[wname], mag = ars.mags[ars.slot];
  const eye = eyeOf(m);
  perceive(bot, eye);
  if (bot.tick >= bot.nextThink || !bot.goal || (bot.fresh && bot.goal.kind !== 'fight' && !bot.passive)) {
    bot.goal = choose(bot, m, ars);
    bot.nextThink = bot.tick + THINK;
  }
  let g = bot.goal, keys = 0, mx = 0, mz = 0, nearest = Infinity, routeLeft = 0;
  for (let i = 0; i < bot.nvis; i++) if (!bot.vis[i].prot && bot.vis[i].d < nearest) nearest = bot.vis[i].d;
  const tgt = g.kind === 'fight' ? bot.mem.get(g.id) : null;
  if (g.kind === 'fight' && (!tgt || bot.tick - tgt.tick > 10)) { bot.goal = null; g = null; } // lost it: choose again next tick
  if (tgt && g) {
    if (bot.target !== g.id) { bot.target = g.id; acquire(a, sk, rand); }
    const dx = tgt.x - m.x, dz = tgt.z - m.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    stepAim(a, sk, DT, eye, seenPoint(bot, g.id, tgt), Math.hypot(m.vx, m.vz) / RUN_SPEED, rand);
    if (!tgt.prot && !bot.passive) inp.fire = shouldFire(a, sk, w, bot.tick, spreadDegrees(wname, m, ars.heat ?? 0));
    // The pistol when the primary is empty up close, or when a close-range
    // primary cannot reach; back to the primary once in its range.
    const primary = WEAPONS[ars.primary], range0 = idealRange(primary, false);
    if (ars.slot === 0 && mag === 0 && d < 12) inp.slot = 1;
    else if (roleOf(primary) === 'close' && ars.slot === 0 && d > 2 * range0) inp.slot = 1;
    else if (roleOf(primary) === 'close' && ars.slot === 1 && d < 1.5 * range0 && ars.mags[0] > 0) inp.slot = 0;
    if (!standsToShoot(a, w)) {
      // Close in or back off along a route, strafing on top.
      if (bot.tick >= bot.flipAt) { bot.strafe = rand() < 0.5 ? -1 : 1; bot.flipAt = bot.tick + Math.round((0.3 + 0.6 * rand()) * TICK_RATE); }
      const range = ars.mags[0] > 0 ? range0 : idealRange(w, ars.slot === 1); // close in for the primary
      const close = d > range * 1.3 ? 1 : d < range * 0.6 ? -1 : 0;
      PT[0] = close > 0 ? tgt.x : close < 0 ? m.x - ux * 4 : m.x;
      PT[1] = m.y;
      PT[2] = close > 0 ? tgt.z : close < 0 ? m.z - uz * 4 : m.z;
      const s = follow(bot.nav, bot.route, m, PT, bot.tick, budget);
      if (s) {
        const l = Math.hypot(s.x - m.x, s.z - m.z);
        if (l > 1e-3) { mx = ((s.x - m.x) / l) * Math.abs(close); mz = ((s.z - m.z) / l) * Math.abs(close); }
        if (s.stuck === 5) bot.strafe = -bot.strafe; // strafing into a wall: the other way first
        if (s.jump) keys |= KEY.JUMP;
      }
      mx += -uz * bot.strafe; mz += ux * bot.strafe;
    }
  } else {
    bot.target = null;
    if (ars.slot === 1) inp.slot = 0; // back to the primary, to reload it
    else if (mag < w.mag * 0.4 && !ars.reload) keys |= KEY.RELOAD;
    if (g) {
      const s = follow(bot.nav, bot.route, m, g.pos, bot.tick, budget);
      if (!s) bot.goal = null;
      else {
        mx = s.x - m.x; mz = s.z - m.z; routeLeft = s.left;
        if (s.jump) keys |= KEY.JUMP;
        if (s.left < 0.8 && g.kind !== 'pad') bot.goal = null; // arrived
      }
    }
    // Look where it walks, or toward what it is hunting.
    if (g?.kind === 'hunt') { PT[0] = g.pos[0]; PT[1] = g.pos[1] + 1.4; PT[2] = g.pos[2]; }
    else { const l = Math.hypot(mx, mz) || 1; PT[0] = m.x + (mx / l) * 5; PT[1] = eye[1]; PT[2] = m.z + (mz / l) * 5; }
    if (mx || mz || g?.kind === 'hunt') stepAim(a, LOOK[bot.skill], DT, eye, PT, 0, rand);
  }
  keys |= moveKeys(a.yaw, mx, mz) | usePowers(bot, nearest, routeLeft, inp.fire);
  inp.keys = keys; inp.yaw = a.yaw; inp.pitch = a.pitch;
  return inp;
}

// Power-ups: every 6 ticks, use the selected item if it fits the moment, or
// select the next one that does.
function usePowers(bot, nearest, routeLeft, firing) {
  const pw = bot.me.pw;
  if (!pw?.inv.length || pw.cd || pw.bolts || bot.tick % 6 !== bot.n % 6) return 0;
  if (!pw.inv.includes('shock')) bot.shockAt = null;
  else bot.shockAt ??= bot.tick + Math.round((1 + 3 * bot.rand()) * TICK_RATE);
  if (wants(bot, pw.inv[pw.sel], nearest, routeLeft, firing)) return KEY.USE;
  return pw.inv.some((k) => wants(bot, k, nearest, routeLeft, firing)) ? KEY.CYCLE : 0;
}

function wants(bot, kind, nearest, routeLeft, firing) {
  const t = bot.tick, a = bot.aim, tgt = bot.target !== null ? bot.mem.get(bot.target) : null;
  const gunOpen = !!tgt && a.ready; // its fire gate is open: nothing that locks the gun
  switch (kind) {
    case 'shield': return bot.me.hp < 60 || t - bot.hurtTick < TICK_RATE;
    case 'nitro': return !tgt && routeLeft > 12;
    default: if (bot.passive) return false;
  }
  switch (kind) {
    case 'shunt': case 'bolt': return gunOpen && !tgt.prot && !firing; // aimed at a reacted-to foe, between shots
    case 'barge': return nearest < 4;
    case 'mine': return !gunOpen && (t - bot.pickTick < 30 || (bot.goal?.kind === 'cover' && bot.nvis > 0));
    case 'shock': return !gunOpen && t >= bot.shockAt && foeLeads(bot);
    default: return false;
  }
}

// Shock hits the leader: only worth it when a foe leads this bot.
function foeLeads(bot) {
  let mine = 0, top = 0;
  for (const p of bot.players) if (p.id === bot.id) mine = p.kills; else top = Math.max(top, p.kills);
  return top >= mine + 1;
}
