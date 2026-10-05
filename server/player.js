// Per-player server state: identity, connection, movement and input queue.

export class Player {
  mover = null; // null until spawned
  queue = [];
  ack = 0; // last input seq the server has consumed
  yaw = 0;
  pitch = 0;

  constructor(id, name, slot, conn, bot) {
    this.id = id;
    this.name = name;
    this.key = name.toLowerCase();
    this.slot = slot;
    this.conn = conn;
    this.bot = bot;
    this.joinedAt = Date.now();
  }

  receive(input) {
    this.queue.push(input);
    if (this.queue.length > 30) this.queue.shift(); // ponytail: crude cap until input hygiene lands
  }

  // Inputs to apply this tick: one per tick, in order.
  nextInputs() {
    const input = this.queue.shift();
    if (!input) return [];
    this.ack = input.s;
    this.yaw = input.yaw;
    this.pitch = input.pitch;
    return [input];
  }
}
