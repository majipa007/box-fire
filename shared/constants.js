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
export const HISTORY_TICKS = 60; // rewind window: 1 s of hitbox positions
export const SNAP_DISTANCE = 2; // m between two ticks: a respawn, so snap instead of blending
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
export const PITCH_LIMIT = (89 * Math.PI) / 180; // look no further up or down than this

// Weapons: damage per hit (per pellet for the shotgun), head multiplier,
// shots per second, magazine, reload seconds (per shell for the shotgun),
// spread in degrees standing still and moving at run speed, and the
// client-only camera kick: degrees per shot, plus extra per shot of a
// spray, climbing for 8 shots.
export const WEAPONS = {
  pistol: { dmg: 26, head: 3, rps: 6.75, auto: false, mag: 12, reload: 1.75, spreadStand: 0.3, spreadMove: 1.5, kick: [0.9, 0] },
  rifle: { dmg: 40, head: 4, rps: 9.75, auto: true, mag: 25, reload: 2.5, spreadStand: 0.4, spreadMove: 2.5, kick: [0.3, 0.12] },
  // Pellet damage falls from full at 8 m to a quarter at 20 m and beyond.
  shotgun: {
    dmg: 8, head: 2, rps: 1.1, auto: false, mag: 5, reload: 0.5, perShell: true,
    spreadStand: 4, spreadMove: 4, pellets: 12, falloff: { from: 8, to: 20, min: 0.25 }, kick: [2.5, 0],
  },
};
export const PRIMARIES = ['rifle', 'shotgun'];
export const SWITCH_SECONDS = 0.4;
export const SPREAD_AIR_FACTOR = 2; // airborne spread: times the moving value
export const SPREAD_CROUCH_FACTOR = 0.8; // crouched spread: times the standing value
// Camera kick: a spray is shots less than KICK_SPRAY_GAP_MS apart; the climb
// stops growing after KICK_CLIMB_SHOTS; sideways wobble is this share of it.
export const KICK_SPRAY_GAP_MS = 300;
export const KICK_CLIMB_SHOTS = 8;
export const KICK_WOBBLE = 0.25;
export const HEAD_SIZE = 0.3;
export const MAX_HP = 100;
export const RESPAWN_SECONDS = 3;
export const SPAWN_PROTECT_SECONDS = 2; // ends early if you fire

// Match: first to KILL_TARGET or MATCH_SECONDS, then a scoreboard.
export const KILL_TARGET = 30;
export const MATCH_SECONDS = 8 * 60;
export const SCOREBOARD_SECONDS = 15;
export const EMPTY_RESET_SECONDS = 30; // nobody connected this long: back to the lobby
export const SPAWN_REUSE_SECONDS = 3; // a spawn point used this recently is skipped
export const SHOT_RANGE = 200;

// One fixed colour per player slot, chosen to pop against the muted map.
export const PLAYER_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
];

// powerups: Blur-style power-ups. Provisional numbers for the design panel.
// Each pad (shared/powerups.js) holds one kind and refills `respawn` seconds
// after a pickup. A player carries up to POWERUP_SLOTS in a queue: use fires
// the first, cycle rotates them. dmg is a direct hit; splash falls off
// linearly to nothing at `radius` m; knock (m/s sideways) and lift (m/s up)
// fall off with it. Power-ups never hurt or push their owner.
export const POWERUP_SLOTS = 3;
export const PICKUP_RADIUS = 0.9; // m from a pad's centre to the player's centre
export const PICKUP_REACH = 1.5; // m: feet this far above the pad still collect it (a jump over it)
export const POWERUPS = {
  nitro: { respawn: 15, seconds: 4, speed: 1.6 }, // movement speed multiplier
  shield: { respawn: 20, hp: 60, seconds: 10 }, // soaks this much damage until spent or expired
  repair: { respawn: 15, hp: 50 },
  // Homing: locks onto the enemy nearest its heading within `cone` degrees
  // and in sight, turning at most `turn` rad/s; explodes on contact or after `life` s.
  shunt: { respawn: 25, speed: 16, turn: 2.5, cone: 30, life: 5, dmg: 70, splash: 35, radius: 2.5, knock: 9, lift: 5 },
  bolt: { respawn: 15, count: 3, gap: 0.12, speed: 55, life: 1.2, dmg: 34, splash: 0, radius: 0, knock: 3, lift: 0 },
  barge: { respawn: 20, splash: 20, radius: 7, knock: 14, lift: 6 }, // a blast centred on the user
  // Dropped at the feet; arms after `arm` s, then any enemy within `trigger` m sets it off.
  mine: { respawn: 15, arm: 1, trigger: 1.5, life: 30, max: 3, splash: 90, radius: 3.5, knock: 10, lift: 7 },
};
export const PROJECTILE_RADIUS = 0.2; // m of slack around a player for a projectile hit
// Knockback is its own velocity on the mover, bleeding off at these m/s².
export const KNOCK_DRAG_GROUND = 30;
export const KNOCK_DRAG_AIR = 3;
