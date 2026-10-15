// How a bot shoots. Pure; `rand` is injected so tests are seeded.
import { TICK_RATE } from '../../shared/constants.js';

// A gun's role, read only from its numbers, so a new gun needs no bot code.
export const roleOf = (w) => ((w.pellets ?? 1) > 1 ? 'close' : w.auto ? 'burst' : w.rps < 2 ? 'precision' : 'tap');

// Where a bot likes to fight from: a sidearm up close, a gun with falloff
// well inside it, anything else at mid range.
export const idealRange = (w, sidearm) => (sidearm ? 12 : w.falloff ? 0.6 * w.falloff.from : 18);

// Per skill: react (s before the first shot at a new target), lag (s behind
// what it sees) and lead (share of the seen velocity it leads by), flick
// (deg of error on acquiring) and settle (s for it to decay), wobble (deg,
// grows with own speed), turn (deg/s), head (chance of aiming at the head),
// stopToShoot (chance per target of standing still to shoot), tapRate
// (clicks/s), duty (share of each 0.5 s an auto gun fires), hear (m), fov
// (deg, full angle), notice (m: seen behind it this close), memory (s).
export const SKILLS = {
  easy: { react: 0.45, lag: 0.22, lead: 0.2, flick: 6, settle: 0.4, wobble: 0.8, turn: 260, head: 0.03, stopToShoot: 0, tapRate: 4, duty: 0.6, hear: 18, fov: 100, notice: 3, memory: 3 },
  normal: { react: 0.3, lag: 0.17, lead: 0.4, flick: 4.5, settle: 0.3, wobble: 0.55, turn: 420, head: 0.12, stopToShoot: 0.2, tapRate: 5, duty: 0.8, hear: 25, fov: 120, notice: 5, memory: 6 },
  hard: { react: 0.2, lag: 0.14, lead: 0.6, flick: 3, settle: 0.22, wobble: 0.45, turn: 720, head: 0.15, stopToShoot: 0.9, tapRate: 6, duty: 1.0, hear: 32, fov: 140, notice: 7, memory: 9 },
};

const D2R = Math.PI / 180;
const gauss = (rand) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // yaw 0 faces -z

// ey, ep: the error (rad) the bot cannot see; t: s since it acquired the
// target; head, steady: rolled once per target; ready: on target and reacted.
export const createAim = (yaw = 0, pitch = 0) => ({ yaw, pitch, ey: 0, ep: 0, t: 0, react: 0, head: false, steady: false, ready: false, tol: 0, click: 0 });

// A new target: a flick error to settle, and this target's head and
// stand-still rolls.
export function acquire(a, sk, rand) {
  const ang = 2 * Math.PI * rand();
  const mag = sk.flick * D2R * (0.5 + rand());
  a.ey = Math.cos(ang) * mag;
  a.ep = Math.sin(ang) * mag * 0.5;
  a.t = 0;
  a.react = sk.react;
  a.head = rand() < sk.head;
  a.steady = rand() < sk.stopToShoot;
}

// One tick toward `seen` (the aim point as the bot perceives it, lagged and
// led by the caller) from `eye`; speedShare is own ground speed / RUN_SPEED.
// Error settles, wobble jitters it, turning is capped. Returns (and keeps in
// a.ready) whether it believes it is on target and has reacted; a.tol is the
// angle (deg) that counts as on target at this range.
export function stepAim(a, sk, dt, eye, seen, speedShare, rand) {
  a.t += dt;
  const k = dt / sk.settle;
  const s = sk.wobble * D2R * (1 + speedShare);
  a.ey += -a.ey * k + s * Math.sqrt(2 * k) * gauss(rand);
  a.ep += -a.ep * k + s * 0.6 * Math.sqrt(2 * k) * gauss(rand);
  const dx = seen[0] - eye[0], dy = seen[1] - eye[1], dz = seen[2] - eye[2];
  const flat = Math.hypot(dx, dz);
  const wy = yawTo(dx, dz), wp = Math.atan2(dy, flat);
  const max = sk.turn * D2R * dt;
  a.yaw = wrap(a.yaw + Math.max(-max, Math.min(max, wrap(wy + a.ey - a.yaw))));
  a.pitch += Math.max(-max, Math.min(max, wp + a.ep - a.pitch));
  const tol = Math.max(1.5 * D2R, Math.atan(0.35 / Math.hypot(flat, dy)));
  a.tol = tol / D2R;
  a.ready = a.t >= sk.react - 1e-9 && Math.hypot(wrap(wy - a.yaw), wp - a.pitch) < tol; // its own error is invisible to it
  return a.ready;
}

// Stand still to shoot (a precision gun always, otherwise if this target's
// roll said so) in a rhythm: stop just before reacting, so the spread has
// settled by the first shot, then stand 0.5 s and strafe 0.5 s in turn.
export const standsToShoot = (a, w) => (a.steady || roleOf(w) === 'precision') && a.t >= a.react - 0.12 && (a.t - a.react + 0.12) % 1 < 0.5;

// Pull the trigger this tick? Only when on target. A bot standing to shoot
// a single-bullet gun also waits for the gun's current spread (deg) to fit
// the target. Auto guns fire `duty` of each half second; semi-auto guns
// click at the slower of the skill's tap rate and the gun's fire rate, and
// never on two ticks in a row (the trigger must come up between shots).
export function shouldFire(a, sk, w, tick, spread) {
  if (!a.ready) return false;
  if ((w.pellets ?? 1) === 1 && standsToShoot(a, w) && spread > a.tol) return false;
  if (w.auto) return tick % 30 < 30 * sk.duty;
  if (tick < a.click) return false;
  a.click = tick + Math.max(2, Math.round(TICK_RATE / Math.min(sk.tapRate, w.rps)));
  return true;
}
