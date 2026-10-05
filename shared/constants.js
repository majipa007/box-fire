// Every tunable number lives here. Starting values, meant to be tuned by feel.

export const PORT = 3000;
export const MAX_PLAYERS = 10;
export const NAME_MAX = 16;

// Connection health: server pings every HEARTBEAT_MS; a socket with no pong
// for SILENT_MS can be taken over by a rejoin, and is closed at DEAD_MS.
export const HEARTBEAT_MS = 500;
export const SILENT_MS = 2000;
export const DEAD_MS = 5000;

// Muted map palette (a box's `color` indexes it) and the sky / fog colour.
export const MAP_COLORS = ['#5b6170', '#8a8f9c', '#6e7b8b', '#a08868', '#7d9177', '#9b7f7f'];
export const SKY_COLOR = '#9fb6cc';

// Simulation clock: one fixed step everywhere.
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const MAX_CATCHUP_TICKS = 5; // after a stall, never run more than this at once
// Jitter knobs, tuned in the first real session: how far behind the newest
// snapshot other players are drawn, and the server's input buffer depth.
export const INTERP_DELAY_TICKS = 2;
export const INPUT_BUFFER = 1;
export const MAX_INPUT_QUEUE = 8; // inputs; beyond this the oldest are dropped
export const NEUTRAL_MS = 250; // no input for this long: the player stops
export const MAX_BUFFERED_BYTES = 64 * 1024; // skip snapshots to a backed-up socket

// Movement (metres, seconds).
export const GRAVITY = 20;
export const JUMP_HEIGHT = 1;
export const RUN_SPEED = 5.5;
export const WALK_SPEED = 2.7;
export const CROUCH_SPEED = 1.8;
export const GROUND_ACCEL = 50; // m/s²: full speed in ~0.1 s, and the same to stop
export const AIR_CONTROL = 0.2;
export const PLAYER_WIDTH = 0.6;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.2;
export const EYE_STAND = 1.6;
export const EYE_CROUCH = 1.1;

// Weapons: damage per hit (per pellet for the shotgun), head multiplier,
// shots per second, magazine, reload seconds (per shell for the shotgun),
// spread in degrees standing still and moving at run speed.
export const WEAPONS = {
  pistol: { dmg: 26, head: 3, rps: 6.75, auto: false, mag: 12, reload: 1.75, spreadStand: 0.3, spreadMove: 1.5 },
  rifle: { dmg: 40, head: 4, rps: 9.75, auto: true, mag: 25, reload: 2.5, spreadStand: 0.4, spreadMove: 2.5 },
};
export const HEAD_SIZE = 0.3;
export const MAX_HP = 100;
export const RESPAWN_SECONDS = 3;
export const SPAWN_REUSE_SECONDS = 3; // a spawn point used this recently is skipped
export const SHOT_RANGE = 200;

// One fixed colour per player slot, chosen to pop against the muted map.
export const PLAYER_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
];
