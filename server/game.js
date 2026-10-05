// Authoritative game state: players, phase and host. Transport is in index.js.
import { MAX_PLAYERS, PLAYER_COLORS } from '../shared/constants.js';
import { encode } from '../shared/protocol.js';

export class Game {
  players = new Map(); // id → player
  nextId = 1;
  phase = 'lobby';
  hostId = null;

  handle(conn, msg) {
    if (msg.t === 'join') return this.join(conn, msg);
    const p = conn.player;
    if (!p) return;
    if (msg.t === 'start' && p.id === this.hostId && this.phase === 'lobby') {
      this.phase = 'playing';
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
    const p = { id: this.nextId++, name, key, bot, conn, slot: this.freeSlot(), joinedAt: Date.now() };
    this.players.set(p.id, p);
    conn.player = p;
    send(conn, { t: 'welcome', id: p.id, map: 'arena_01' });
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

  broadcastLobby() {
    const msg = encode({
      t: 'lobby',
      phase: this.phase,
      host: this.hostId,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, slot: p.slot, ping: p.conn.rtt, bot: p.bot })),
    });
    for (const p of this.players.values()) sendRaw(p.conn, msg);
  }
}

const send = (conn, msg) => sendRaw(conn, encode(msg));

function sendRaw(conn, data) {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(data);
}
