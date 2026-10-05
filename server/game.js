// Authoritative game state: players, phase, host and the 60 Hz simulation.
// Transport is in index.js.
import {
  MAX_PLAYERS, PLAYER_COLORS, TICK_RATE, MAX_CATCHUP_TICKS, MAX_BUFFERED_BYTES,
} from '../shared/constants.js';
import { encode } from '../shared/protocol.js';
import { createMover, step } from '../shared/movement.js';
import { prepareMap } from '../shared/collision.js';
import { Player } from './player.js';

const r3 = (v) => Math.round(v * 1000) / 1000;

export class Game {
  players = new Map(); // id → Player
  nextId = 1;
  phase = 'lobby';
  hostId = null;
  tick = 0;

  constructor(mapId, mapJson) {
    this.mapId = mapId;
    this.map = prepareMap(mapJson);
  }

  handle(conn, msg) {
    if (msg.t === 'join') return this.join(conn, msg);
    const p = conn.player;
    if (!p) return;
    if (msg.t === 'input') {
      if (p.mover) p.receive(msg);
    } else if (msg.t === 'start' && p.id === this.hostId && this.phase === 'lobby') {
      this.phase = 'playing';
      for (const q of this.players.values()) this.spawn(q);
      this.broadcastLobby();
    }
  }

  join(conn, { name, bot }) {
    if (conn.player) return;
    const key = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.key === key) return send(conn, { t: 'reject', reason: 'name-taken' });
    }
    if (this.players.size >= MAX_PLAYERS) return send(conn, { t: 'reject', reason: 'full' });
    const p = new Player(this.nextId++, name, this.freeSlot(), conn, bot);
    this.players.set(p.id, p);
    conn.player = p;
    send(conn, { t: 'welcome', id: p.id, map: this.mapId, tickRate: TICK_RATE });
    if (this.phase === 'playing') this.spawn(p);
    this.electHost();
    this.broadcastLobby();
  }

  disconnect(conn) {
    const p = conn.player;
    if (!p) return;
    this.players.delete(p.id);
    this.electHost();
    this.broadcastLobby();
  }

  spawn(p) {
    const spawns = this.map.spawns;
    const [x, y, z] = spawns[Math.floor(Math.random() * spawns.length)];
    p.mover = createMover(x, y, z);
    p.queue = [];
    p.yaw = Math.atan2(x, z); // face the arena centre
    p.pitch = 0;
    this.broadcast({ t: 'event', e: 'spawn', id: p.id, x, y, z, yaw: p.yaw });
  }

  freeSlot() {
    const used = new Set([...this.players.values()].map((p) => p.slot));
    return PLAYER_COLORS.findIndex((_, i) => !used.has(i));
  }

  // The loopback player if one is connected, else the longest-connected
  // player. Bots run on the host machine too, so they never qualify.
  electHost() {
    const humans = [...this.players.values()].filter((p) => !p.bot).sort((a, b) => a.joinedAt - b.joinedAt);
    this.hostId = (humans.find((p) => p.conn.loopback) ?? humans[0])?.id ?? null;
  }

  step() {
    this.tick++;
    if (this.phase === 'playing') {
      for (const p of this.players.values()) {
        if (!p.mover) continue;
        for (const input of p.nextInputs()) step(p.mover, input, this.map.boxes);
      }
      this.sendSnapshots();
    }
    if (this.tick % TICK_RATE === 0) this.broadcastLobby(); // refresh pings
  }

  // Everyone gets every player's public state (rounded, for interpolation)
  // plus their own full movement state at full precision, for reconciliation.
  sendSnapshots() {
    const ps = JSON.stringify([...this.players.values()].filter((p) => p.mover).map((p) => {
      const m = p.mover;
      return [p.id, r3(m.x), r3(m.y), r3(m.z), r3(p.yaw), r3(p.pitch), m.crouch ? 1 : 0];
    }));
    for (const p of this.players.values()) {
      const { ws } = p.conn;
      // A backed-up socket would only get a burst of stale snapshots.
      if (ws.readyState !== ws.OPEN || ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      ws.send(`{"t":"snapshot","tick":${this.tick},"ack":${p.ack},"me":${JSON.stringify(p.mover)},"ps":${ps}}`);
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
          console.log(`ticks: ${count} in 10 s, interval avg ${(Number(sum / BigInt(count || 1)) / 1e6).toFixed(1)} ms, max ${(Number(max) / 1e6).toFixed(1)} ms`);
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

  broadcast(msg) {
    const data = encode(msg);
    for (const p of this.players.values()) sendRaw(p.conn, data);
  }

  broadcastLobby() {
    this.broadcast({
      t: 'lobby',
      phase: this.phase,
      host: this.hostId,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, slot: p.slot, ping: p.conn.rtt, bot: p.bot })),
    });
  }
}

const send = (conn, msg) => sendRaw(conn, encode(msg));

function sendRaw(conn, data) {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(data);
}
