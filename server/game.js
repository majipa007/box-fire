// Authoritative game state: players, phase, host and the 60 Hz simulation.
// Transport is in index.js.
import {
  MAX_PLAYERS, PLAYER_COLORS, TICK_RATE, MAX_CATCHUP_TICKS, MAX_BUFFERED_BYTES,
  RESPAWN_SECONDS, SPAWN_REUSE_SECONDS, SPAWN_PROTECT_SECONDS,
  KILL_TARGET, MATCH_SECONDS, SCOREBOARD_SECONDS, SILENT_MS, EMPTY_RESET_SECONDS,
} from '../shared/constants.js';
import { encode, byScore, PLAYER_FLAGS, WEAPON_IDS, POWER_IDS } from '../shared/protocol.js';
import { step } from '../shared/movement.js';
import { prepareMap } from '../shared/collision.js';
import { freshLife, stepWeapon, weaponOf, eyeOf, shotDirs, traceShot, damageAt, shotHeat, scopedIn, moveFactor } from '../shared/weapons.js'; // weapons: shotHeat; arsenal: scope, pace
import { shotRng } from '../shared/rng.js';
import { Player } from './player.js';
import { History } from './history.js';
import { PowerServer, freshPowers } from './powerups.js'; // POWER-UPS: pads and entities
import { stepPowers, createPowers } from '../shared/powerups.js'; // POWER-UPS: inventory step

const r3 = (v) => Math.round(v * 1000) / 1000;

// The next match's map (the plan's vote rules): most votes; a tie goes to the
// host's pick if it is one of the tied maps, else the earliest tied map in
// `order`; no votes at all keeps `current`. votes: one map id per voter.
export function pickMap(votes, hostVote, order, current) {
  const tally = order.map((id) => votes.filter((v) => v === id).length);
  const top = Math.max(0, ...tally);
  if (!top) return current;
  const tied = order.filter((_, i) => tally[i] === top);
  return tied.includes(hostVote) ? hostVote : tied[0];
}

export class Game {
  players = new Map(); // id → Player
  nextId = 1;
  phase = 'lobby'; // lobby → playing → scoreboard → playing …
  phaseEndsAt = 0; // tick the current match or scoreboard ends
  hostId = null;
  tick = 0;
  emptySince = null; // tick the last connected player left
  seed = Math.floor(Math.random() * 2 ** 32); // one per server run, seeds every shot's spread

  // maps: id → map JSON for every playable map, in vote order (index.js loads
  // them all at startup). A vote naming anything else is ignored.
  constructor(mapId, mapJson, maps = new Map([[mapId, mapJson]])) {
    this.maps = maps;
    this.setMap(mapId);
  }

  // A fresh world on this map: spawns, rewind history, pads up and nothing in play.
  setMap(id) {
    this.mapId = id;
    this.map = prepareMap(this.maps.get(id));
    this.spawnUsedAt = this.map.spawns.map(() => -Infinity); // tick each spawn was last used
    this.history = new History();
    this.powers = new PowerServer(this); // POWER-UPS: pads, Shunts, Mines, domes
  }

  handle(conn, msg) {
    if (msg.t === 'join') return this.join(conn, msg);
    const p = conn.player;
    if (!p) return;
    if (msg.t === 'input') {
      if (p.mover) p.receive(msg, performance.now());
    } else if (msg.t === 'loadout') {
      // Takes effect at the next spawn. arsenal: either pick may be left out.
      if (msg.primary) p.primary = msg.primary;
      if (msg.secondary) p.secondary = msg.secondary;
    } else if (msg.t === 'start' && p.id === this.hostId && this.phase === 'lobby') {
      this.startMatch();
    } else if (msg.t === 'end_match' && p.id === this.hostId && this.phase === 'playing') {
      this.endMatch();
    } else if (msg.t === 'vote' && !p.bot && this.maps.has(msg.map) && msg.map !== p.vote && this.phase !== 'playing') {
      p.vote = msg.map; // a new vote replaces the old one
      this.broadcastLobby();
    }
  }

  join(conn, { name, bot, primary, secondary }) {
    if (conn.player) return;
    // arsenal: the pick is set before attach() can spawn a drop-in player.
    const pickUp = (p) => { if (primary) p.primary = primary; if (secondary) p.secondary = secondary; return p; };
    const key = name.toLowerCase();
    const existing = [...this.players.values()].find((p) => p.key === key);
    if (existing) {
      // Rejoin by name: allowed once the old socket is gone, or has been
      // silent long enough to be a crashed tab. The score comes back.
      const old = existing.conn;
      if (old && Date.now() - (old.lastPong ?? 0) <= SILENT_MS) return send(conn, { t: 'reject', reason: 'name-taken' });
      if (old) {
        old.player = null; // its close event, when it comes, is ignored
        old.ws.terminate();
        if (this.phase !== 'lobby') this.leave(existing);
      }
      return this.attach(pickUp(existing), conn);
    }
    // Greyed-out players keep their slot until the match ends.
    if (this.players.size >= MAX_PLAYERS) return send(conn, { t: 'reject', reason: 'full' });
    const p = pickUp(new Player(this.nextId++, name, this.freeSlot(), conn, bot));
    this.players.set(p.id, p);
    this.attach(p, conn);
  }

  attach(p, conn) {
    p.conn = conn;
    conn.player = p;
    p.joinedAt = Date.now();
    p.resetInput(); // a new tab numbers its inputs from 1 again
    send(conn, { t: 'welcome', id: p.id, map: this.mapId, tickRate: TICK_RATE, seed: this.seed });
    // New to this match: spawn now. Back from a disconnect: the respawn timer
    // that started when they left still applies.
    if (this.phase === 'playing' && !p.mover) this.spawn(p);
    this.electHost();
    this.broadcastLobby();
  }

  // Mid-match, a player who leaves stays on the scoreboard, greyed out and
  // out of the world, until the match ends; in the lobby they just go.
  disconnect(conn) {
    const p = conn.player;
    if (!p || p.conn !== conn) return;
    conn.player = null;
    if (this.phase === 'lobby') this.players.delete(p.id);
    else this.leave(p);
    this.electHost();
    this.broadcastLobby();
  }

  // Leaving mid-match, by closing or by a silent tab being taken over,
  // counts as dying without a kill: the respawn timer starts, so a rejoin
  // gets a fresh spawn (and refreshing the page is no way to heal).
  leave(p) {
    p.conn = null;
    p.vote = null; // a player who leaves loses their vote
    if (p.alive) p.respawnAt = this.tick + RESPAWN_SECONDS * TICK_RATE;
    p.alive = false;
  }

  // Lobby Start and the scoreboard's restart: the vote picks the map, then
  // every vote clears so the next scoreboard is a fresh one.
  startMatch() {
    for (const p of this.players.values()) if (!p.conn) this.players.delete(p.id);
    const next = pickMap(this.votes().map((p) => p.vote), this.players.get(this.hostId)?.vote, [...this.maps.keys()], this.mapId);
    if (next !== this.mapId) console.log(`map: ${this.maps.get(next).name ?? next}`);
    this.setMap(next); // the same map too: pads up, nothing in play, as every match starts
    for (const p of this.players.values()) p.vote = null;
    this.phase = 'playing';
    this.phaseEndsAt = this.tick + MATCH_SECONDS * TICK_RATE;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.pk = 0; // POWER-UPS: power-up kills
      p.alive = false;
    }
    for (const p of this.players.values()) this.spawn(p);
    this.broadcastLobby();
  }

  // First to the kill target, the clock, or the host's End match: freeze the
  // world and show the scoreboard, then go again on the map voted for.
  endMatch() {
    this.phase = 'scoreboard';
    this.phaseEndsAt = this.tick + SCOREBOARD_SECONDS * TICK_RATE;
    const ranked = [...this.players.values()].sort(byScore);
    // POWER-UPS: the balance target is at most 25% of kills by power-ups.
    const kills = ranked.reduce((n, p) => n + p.kills, 0);
    if (kills) console.log(`power-up kill share: ${Math.round((100 * ranked.reduce((n, p) => n + p.pk, 0)) / kills)}%`);
    this.broadcast({ t: 'event', e: 'match_end', winner: ranked[0]?.kills ? ranked[0].id : null }); // no kills, no winner
    this.broadcastLobby();
  }

  // Furthest from the nearest living enemy, skipping points used in the last
  // few seconds so two players who die together never spawn stacked.
  pickSpawn(p) {
    const recent = this.tick - SPAWN_REUSE_SECONDS * TICK_RATE;
    const all = this.map.spawns.map((pos, i) => ({ pos, i }));
    const fresh = all.filter(({ i }) => this.spawnUsedAt[i] < recent);
    const pool = fresh.length ? fresh : all;
    const enemies = [...this.players.values()].filter((q) => q !== p && q.alive);
    if (!enemies.length) return pool[Math.floor(Math.random() * pool.length)];
    const clearance = ({ pos: [x, , z] }) => Math.min(...enemies.map((q) => Math.hypot(q.mover.x - x, q.mover.z - z)));
    return pool.reduce((best, s) => (clearance(s) > clearance(best) ? s : best));
  }

  spawn(p) {
    const { pos: [x, y, z], i } = this.pickSpawn(p);
    this.spawnUsedAt[i] = this.tick;
    Object.assign(p, freshLife(x, y, z, p.primary, p.secondary)); // arsenal: both picks
    p.protectedUntil = this.tick + SPAWN_PROTECT_SECONDS * TICK_RATE;
    p.pw = freshPowers(); // POWER-UPS: empty inventory, no Shield
    p.queue = []; // inputs sent before this life are stale
    p.buffering = true;
    p.last = null; // nor may the last one leak a weapon slot into this life
    p.yaw = Math.atan2(x, z); // face the arena centre
    p.pitch = 0;
    this.broadcast({ t: 'event', e: 'spawn', id: p.id, x, y, z, yaw: p.yaw, primary: p.primary, secondary: p.secondary }); // arsenal: secondary
  }

  freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    return PLAYER_COLORS.findIndex((_, i) => !used.has(i));
  }

  // The loopback player if one is connected, else the longest-connected
  // player. Bots run on the host machine too, so they never qualify.
  electHost() {
    const humans = [...this.players.values()].filter((p) => !p.bot && p.conn).sort((a, b) => a.joinedAt - b.joinedAt);
    this.hostId = (humans.find((p) => p.conn.loopback) ?? humans[0])?.id ?? null;
  }

  step() {
    this.tick++;
    // Nobody connected for a while: back to the lobby with scores cleared.
    if (this.phase === 'lobby' || [...this.players.values()].some((p) => p.conn)) this.emptySince = null;
    else if (this.emptySince === null) this.emptySince = this.tick;
    else if (this.tick - this.emptySince >= EMPTY_RESET_SECONDS * TICK_RATE) {
      this.players.clear();
      this.phase = 'lobby';
      this.emptySince = null;
      return;
    }
    if (this.phase === 'playing') {
      const now = performance.now();
      for (const p of this.players.values()) {
        if (!p.mover) continue;
        const inputs = p.nextInputs(now);
        if (!p.alive) {
          if (p.conn && this.tick >= p.respawnAt) this.spawn(p);
          continue;
        }
        for (const input of inputs) {
          step(p.mover, input, this.map.boxes, moveFactor(p.arsenal)); // arsenal: the held gun's pace, before its step, as predicted
          if (stepWeapon(p.arsenal, input)) {
            p.protectedUntil = 0; // firing ends spawn protection
            this.fire(p, input);
          }
          const kind = stepPowers(p.pw, p.mover, p.arsenal, input); // POWER-UPS: after the gun, as predicted
          if (kind) {
            p.protectedUntil = 0; // so does using one
            this.powers.use(p, kind, input);
          }
        }
      }
      this.powers.step(); // POWER-UPS: pickups, Shunts, Mines, domes, queued hits
      this.history.record(this.tick, [...this.players.values()].filter((p) => p.alive).map((p) => {
        const { x, y, z, crouch } = p.mover;
        return [p.id, { x, y, z, crouch }];
      }));
      this.sendSnapshots();
      const top = Math.max(0, ...[...this.players.values()].map((p) => p.kills));
      if (top >= KILL_TARGET || this.tick >= this.phaseEndsAt) this.endMatch();
    } else if (this.phase === 'scoreboard' && this.tick >= this.phaseEndsAt) {
      this.startMatch();
    }
    if (this.tick % TICK_RATE === 0) this.broadcastLobby(); // refresh pings
  }

  fire(p, input) {
    const weapon = weaponOf(p.arsenal);
    const origin = eyeOf(p.mover);
    // Rewind: test against the others where this shooter saw them, at the
    // render tick their input carries, as long as they are still alive now.
    const targets = this.history.at(input.rt, this.tick).filter((q) => q.id !== p.id && this.players.get(q.id)?.alive);
    // The shot number seeds the spread exactly as the client rolled it.
    const dirs = shotDirs(input.yaw, input.pitch, weapon, p.mover, shotRng(this.seed, p.id, input.shot), shotHeat(p.arsenal), scopedIn(p.arsenal)); // weapons: bloom, as predicted; arsenal: the scoped cone
    const hits = new Map(); // victim id → { dmg, heads, n }, summed over landed pellets
    const ends = dirs.map((dir) => {
      const hit = traceShot(origin, dir, this.map.boxes, targets);
      this.powers.shot(p, origin, dir, hit.t, input.rt); // POWER-UPS: bullets fizzle Shunts and set off Mines
      if (hit.id !== null) {
        const h = hits.get(hit.id) ?? { dmg: 0, heads: 0, n: 0 };
        h.dmg += damageAt(weapon, hit.head, hit.t);
        h.heads += hit.head;
        h.n++;
        hits.set(hit.id, h);
      }
      return origin.map((o, i) => r3(o + dir[i] * hit.t));
    });
    this.broadcast({ t: 'event', e: 'shot', id: p.id, w: weapon, o: origin.map(r3), h: ends }, p);
    // weapons: whole HP; a blast is a headshot when most of its landed pellets were.
    for (const [id, { dmg, heads, n }] of hits) this.damage(p, this.players.get(id), Math.round(dmg), heads * 2 > n, weapon);
  }

  // POWER-UPS: sx, sz are a power-up blast's source, for the damage arc.
  damage(attacker, victim, dmg, head, weapon, sx, sz) {
    if (attacker === victim) return; // POWER-UPS: never by your own power-up
    if (this.tick < victim.protectedUntil) return; // spawn protection
    const sh = Math.min(victim.pw.shield, dmg); // POWER-UPS: a Shield soaks it first
    victim.pw.shield -= sh;
    dmg -= sh;
    victim.hp = Math.max(0, victim.hp - dmg);
    const hit = encode({ t: 'event', e: 'hit', a: attacker.id, v: victim.id, dmg, head, w: weapon, sh: sh || undefined, sx, sz });
    sendRaw(attacker.conn, hit);
    sendRaw(victim.conn, hit);
    if (victim.hp > 0) return;
    victim.alive = false;
    victim.deaths++;
    attacker.kills++;
    if (POWER_IDS.includes(weapon)) attacker.pk++; // POWER-UPS
    victim.pw = createPowers(); // POWER-UPS: death clears the inventory
    victim.respawnAt = this.tick + RESPAWN_SECONDS * TICK_RATE;
    this.broadcast({ t: 'event', e: 'kill', k: attacker.id, v: victim.id, w: weapon, head });
    this.broadcastLobby();
  }

  // Everyone gets every player's public state (rounded, for interpolation)
  // plus their own full state at full precision, for reconciliation.
  sendSnapshots() {
    const ps = JSON.stringify([...this.players.values()].filter((p) => p.mover).map((p) => {
      const m = p.mover;
      const flags = (m.crouch ? PLAYER_FLAGS.CROUCH : 0) | (p.alive ? PLAYER_FLAGS.ALIVE : 0)
        | (this.tick < p.protectedUntil ? PLAYER_FLAGS.SHIELDED : 0)
        | (p.pw.shield > 0 ? PLAYER_FLAGS.BUBBLE : 0) | (m.boost > 0 ? PLAYER_FLAGS.NITRO : 0) | (m.slow > 0 ? PLAYER_FLAGS.SLOWED : 0); // POWER-UPS
      return [p.id, r3(m.x), r3(m.y), r3(m.z), r3(p.yaw), r3(p.pitch), flags, p.hp, WEAPON_IDS.indexOf(weaponOf(p.arsenal))];
    }));
    const pu = this.powers.snapshot(); // POWER-UPS: pads and entities, once per tick
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const { ws } = p.conn;
      // A backed-up socket would only get a burst of stale snapshots.
      if (ws.readyState !== ws.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      const me = p.mover ? JSON.stringify({ mover: p.mover, arsenal: p.arsenal, hp: p.hp, alive: p.alive, pw: p.pw }) : 'null'; // POWER-UPS: pw
      ws.send(`{"t":"snapshot","tick":${this.tick},"ack":${p.ack},"me":${me},"ps":${ps},"pu":${pu}}`);
    }
  }

  // Fixed-step loop on the high-resolution clock. setInterval drifts under
  // load; this catches up instead, but never more than a few ticks at once.
  startLoop() {
    const stepNs = BigInt(Math.round(1e9 / TICK_RATE));
    let next = process.hrtime.bigint();
    let last = next;
    let logAt = next;
    let count = 0;
    let sum = 0n;
    let max = 0n;
    const loop = () => {
      const now = process.hrtime.bigint();
      for (let n = 0; now >= next && n < MAX_CATCHUP_TICKS; n++) {
        this.step();
        next += stepNs;
        const t = process.hrtime.bigint();
        const interval = t - last;
        last = t;
        count++;
        sum += interval;
        if (interval > max) max = interval;
      }
      if (now >= next) next = now + stepNs; // stalled past the cap: drop the backlog
      if (now - logAt >= 10_000_000_000n) {
        if (this.players.size) {
          const inputs = { underflow: 0, overflow: 0 };
          for (const p of this.players.values()) {
            for (const k in inputs) inputs[k] += p.stats[k];
            p.stats = { underflow: 0, overflow: 0 };
          }
          console.log(`ticks: ${count} in 10 s, interval avg ${(Number(sum / BigInt(count || 1)) / 1e6).toFixed(1)} ms, max ${(Number(max) / 1e6).toFixed(1)} ms; inputs: ${inputs.underflow} buffer underflows, ${inputs.overflow} dropped by overflow`);
        }
        logAt = now;
        count = 0;
        sum = 0n;
        max = 0n;
      }
      setTimeout(loop, Math.max(0, Number(next - process.hrtime.bigint()) / 1e6 - 1));
    };
    loop();
  }

  broadcast(msg, except = null) {
    const data = encode(msg);
    for (const p of this.players.values()) if (p !== except) sendRaw(p.conn, data);
  }

  // The players whose vote counts: connected humans who have voted.
  votes() {
    return [...this.players.values()].filter((p) => p.vote && p.conn && !p.bot);
  }

  broadcastLobby() {
    const voters = this.votes();
    this.broadcast({
      t: 'lobby',
      phase: this.phase,
      tick: this.tick,
      end: this.phaseEndsAt,
      host: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, slot: p.slot, ping: p.conn?.rtt ?? 0, bot: p.bot, kills: p.kills, deaths: p.deaths, pk: p.pk, connected: !!p.conn, // POWER-UPS: pk
      })),
      map: this.mapId, // the map being played (in the lobby: the one kept if nobody votes)
      // One card per map, in vote order: its tally and who voted for it.
      maps: [...this.maps].map(([id, { name, tagline }]) => {
        const ids = voters.filter((p) => p.vote === id).map((p) => p.id);
        return { id, name, tagline, votes: ids.length, voters: ids };
      }),
    });
  }
}

const send = (conn, msg) => sendRaw(conn, encode(msg));

function sendRaw(conn, data) {
  if (conn && conn.ws.readyState === conn.ws.OPEN) conn.ws.send(data); // null: a greyed-out player
}
