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
// weapons: falloff scales damage from full at `from` m down to `min` at `to`
// m and beyond. headDmg, when set, replaces head × dmg: every headshot does
// it flat, at any range, mid-spray too. bloom: degrees of extra spread per
// unit of spray heat (+1 a shot, -cool a second, capped at bloomMax / bloom).
export const WEAPONS = {
  pistol: { dmg: 26, head: 3, rps: 6.75, auto: false, mag: 12, reload: 1.75, spreadStand: 0.3, spreadMove: 1.5, kick: [0.9, 0], falloff: { from: 25, to: 40, min: 0.75 } },
  rifle: {
    dmg: 30, head: 3, headDmg: 160, rps: 9.75, auto: true, mag: 25, reload: 2.5, spreadStand: 0.15, spreadMove: 2.5, kick: [0.3, 0.12], falloff: { from: 20, to: 30, min: 0.8 },
    bloom: 0.25, cool: 4, bloomMax: 2,
  },
  // 12 × 10 = 120: a full blast kills 100 HP, not a Shield's 160 (weapons:).
  // Pellet damage falls from full at 8 m to a fifth at 18 m and beyond.
  shotgun: {
    dmg: 10, head: 2, rps: 1.1, auto: false, mag: 5, reload: 0.5, perShell: true,
    spreadStand: 3.5, spreadMove: 3.5, pellets: 12, falloff: { from: 8, to: 18, min: 0.2 }, kick: [2.5, 0],
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
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#ff7eb6',
];

// POWER-UPS: Blur-style items (docs/bible.md §4.4). Seconds and metres
// unless named ticks; turn is degrees/s; knock and lift are m/s. Pads hold
// their pool's items in turn and refill `respawn` s after a pickup (longer
// in small games, see padRespawnTicks).
export const POWER_COLORS = { shunt: '#ff2a1a', bolt: '#2e9bff', barge: '#a070ff', shock: '#ffb300', mine: '#ffffff', nitro: '#3dff8f', shield: '#66fff0' };
export const POWER_CAPACITY = 3;
export const POWER_USE_SECONDS = 1;
export const POWER_GUN_LOCK = 0.25;
export const POWER_BOLT_GUN_LOCK = 0.55;
export const POWER_RATE_PLAYERS = 6; // pads refill slower below this many players
export const POWER_PAD_BOX = [1.6, 2, 1.6]; // pickup trigger standing on a pad
export const COYOTE_TICKS = 5;
export const JUMP_BUFFER_TICKS = 6;
export const KNOCK_MAX = 12; // m/s horizontal after any knock
export const POWERS = {
  shunt: { speed: 18, turn: 110, life: 4, cone: 25, range: 40, proximity: 0.6, direct: 60, splash: 2.5, splashMax: 40, splashMin: 10, knock: 7, lift: 5, box: 0.5 },
  bolt: { shots: 3, gap: 0.25, dmg: 25 },
  barge: { radius: 5, dmgMax: 20, dmgMin: 10, knock: 9, lift: 5.5 },
  shock: { domes: 3, lead: 1.2, step: 0.4, radius: 2.5, dmg: 30, slow: 0.6, slowSeconds: 2 },
  mine: { arm: 0.8, trigger: 1.2, fuse: 0.25, radius: 2.5, dmgMax: 60, dmgMin: 15, knock: 5, lift: 6, life: 40, perOwner: 2, box: [0.5, 0.3, 0.5] },
  nitro: { seconds: 4, speed: 1.4 },
  shield: { hp: 60, seconds: 8 },
};

// Every playable map, in vote order. Map files are shared/maps/<id>.json; a
// vote or a MAP= override naming anything else is ignored.
export const MAPS = ['arena_01', 'arena_02'];
