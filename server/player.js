// Per-player server state: identity, connection, movement and input queue.
import { INPUT_BUFFER, MAX_INPUT_QUEUE, NEUTRAL_MS } from '../shared/constants.js';
import { KEY } from '../shared/movement.js';

const PRESSES = KEY.USE | KEY.CYCLE; // powerups: press-once bits carried past an overflow drop

export class Player {
  mover = null; // null until spawned
  arsenal = null;
  primary = 'rifle';
  hp = 0;
  inv = []; // powerups: power-up kinds held, the first fires next
  shield = 0; // powerups: damage a Shield still soaks
  shieldUntil = 0; // powerups: tick it expires
  alive = false;
  respawnAt = 0; // tick
  protectedUntil = 0; // tick spawn protection ends
  kills = 0;
  deaths = 0;
  ack = 0; // seq of the last input simulated
  yaw = 0;
  pitch = 0;
  // Every input is one fixed step, applied in order exactly once, so the
  // client's prediction replays the same steps the server ran.
  queue = [];
  buffering = true; // refilling the jitter buffer before applying again
  receivedAt = -Infinity; // when the last input arrived (ms)
  last = null; // last input simulated
  stats = { underflow: 0, overflow: 0 }; // for the host's tuning log

  constructor(id, name, slot, conn, bot) {
    this.id = id;
    this.name = name;
    this.key = name.toLowerCase();
    this.slot = slot;
    this.conn = conn;
    this.bot = bot;
    this.joinedAt = Date.now();
  }

  resetInput() {
    this.queue = [];
    this.buffering = true;
    this.receivedAt = -Infinity;
    this.last = null;
    this.ack = 0;
  }

  receive(input, now) {
    const newest = this.queue.at(-1)?.s ?? this.ack;
    if (input.s <= newest) return; // already have it
    this.queue.push(input);
    this.receivedAt = now;
    // A backlog this deep would only replay as a fast-forward: drop the oldest.
    if (this.queue.length > MAX_INPUT_QUEUE) {
      this.stats.overflow += this.queue.length - MAX_INPUT_QUEUE;
      const dropped = this.queue.splice(0, this.queue.length - MAX_INPUT_QUEUE);
      // The client already showed that click as a shot: keep the earliest one,
      // with the shot number and render tick it was fired with.
      const click = dropped.find((i) => i.fire);
      if (click && !this.queue[0].fire) this.queue[0] = { ...this.queue[0], fire: true, shot: click.shot, rt: click.rt };
      // powerups: so do power-up presses (one of each at most).
      const presses = dropped.reduce((bits, i) => bits | (i.keys & PRESSES), 0);
      if (presses & ~this.queue[0].keys) this.queue[0] = { ...this.queue[0], keys: this.queue[0].keys | presses };
    }
  }

  // Inputs to simulate this tick: normally one; two to catch up a backlog,
  // never more, so a stalled client does not teleport when it wakes. Nothing
  // is ever invented: a tick with no input leaves the player where they are.
  nextInputs(now) {
    if (!this.queue.length) {
      // Silent for too long (a background tab, a dead link): stand still and
      // keep looking the same way.
      const silent = !(now - this.receivedAt <= NEUTRAL_MS);
      if (!this.buffering && !silent) this.stats.underflow++;
      this.buffering = true;
      return silent ? [{ keys: 0, yaw: this.yaw, pitch: this.pitch, fire: false, shot: 0, slot: this.last?.slot ?? 0, rt: 0 }] : [];
    }
    if (this.buffering) {
      if (this.queue.length <= INPUT_BUFFER) return [];
      this.buffering = false;
    }
    const out = this.queue.splice(0, this.queue.length > INPUT_BUFFER + 1 ? 2 : 1);
    for (const input of out) this.apply(input);
    return out;
  }

  apply(input) {
    this.last = input;
    this.ack = input.s;
    this.yaw = input.yaw;
    this.pitch = input.pitch;
  }
}
