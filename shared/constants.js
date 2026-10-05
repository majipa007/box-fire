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

export const EYE_STAND = 1.6;

// One fixed colour per player slot, chosen to pop against the muted map.
export const PLAYER_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
];
