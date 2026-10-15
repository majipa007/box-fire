// Web Audio synthesis: every sound is generated, so there are no asset
// files. A sound is a recipe of layers (filtered noise and gliding sines)
// that start() renders once into a few seeded variants. The DSP is plain
// JavaScript, so the tests run it in Node. Playing a sound is then a short
// graph: buffer → [distance lowpass] → gain → [pan] → bus, plus sends to one
// shared convolution reverb and one shared quarry slapback. Browsers keep
// audio muted until a user gesture, so start() runs inside a click.
//
// Audio must never break the game: every export is a no-op until start()
// succeeds, and swallows its own errors.
//
// ?debug&sfx plays every sound in turn (BOARD, about 600 ms apart).
import { shotRng } from '../shared/rng.js';
import { prepareMap } from '../shared/collision.js';
import { SHOT_RANGE, POWER_COLORS } from '../shared/constants.js';
import { KEY } from '../shared/movement.js';
// Namespaces, not named imports, for both power-up wires: the engine wave's
// padsFor and entity tuple are gone (or going) from the bible's modules, and
// one missing named import fails the whole page.
import * as wire from '../shared/protocol.js';
import * as sharedPowers from '../shared/powerups.js';

/* ----------------------------------------------------------------------------
 * Look constants: every level, timing and timbre. Seconds, Hz, dB.
 *
 * A recipe is { layers, level, n, vary, drive, send, slap, dry, loop }:
 *   layers  named layers, summed;
 *   level   dB: its loudest 50 ms plays at this level (see shortTerm), so
 *           the levels below are the mix table, whatever the timbre;
 *   n       variants rendered (default 1);
 *   vary    ± jitter of each layer's f, f1, d and g per variant (default
 *           VARY); 0 also turns off the pitch jitter per play;
 *   drive   tanh saturation for density and punch (default 1: none);
 *   send    reverb send multiplier (default 1);
 *   slap    also sent to the quarry slapback (guns and blasts);
 *   dry     your own feedback: the confirm bus, never jittered, no reverb;
 *   loop    seconds: a seamless sustained loop instead of a one-shot.
 * A layer is { src: 'noise' | 'sine', at, a, d | dur, g, ... }: it starts at
 * `at`, rises over `a`, then decays with time constant `d`, or so that it is
 * down 40 dB at `dur`, at gain `g` (default 1).
 *   noise: mode 'lp' | 'bp' | 'hp', cutoff f, q; density < 1 makes crackle.
 *   sine:  pitch f; partials [[ratio, gain, decay×], ...] (SQUARE, SAW and
 *          TRI build those waves); fm [ratio, index] phase modulation.
 *   both:  f1 with `sweep` s reaches f1 at that time on a log scale; f1 with
 *          `glide` s approaches it with that time constant instead;
 *          am [rate, depth] tremolo.
 * ------------------------------------------------------------------------- */

// Band-limited waves as sine partials: the renderer skips any above 0.45 fs.
const harmonics = (n, amp) => Array.from({ length: n }, (_, i) => [i + 1, amp(i + 1), 1]).filter((p) => p[1] > 0);
export const SQUARE = harmonics(11, (k) => (k % 2 ? 1 / k : 0));
export const SAW = harmonics(12, (k) => 1 / k);
export const TRI = harmonics(7, (k) => (k % 2 ? 1 / (k * k) : 0));
const SAW_LP = harmonics(12, (k) => 1 / k / Math.hypot(1, (k * 440) / 1400)); // a saw through a 1.4 kHz lowpass
const BELL = [[1, 1, 1], [2.756, 0.45, 0.55], [5.404, 0.25, 0.3]];
const CHIME = [[1, 1, 1], [2, 0.25, 0.6], [3, 0.12, 0.4]];
const semis = (n) => 2 ** (n / 12);

// Gunshots (§5): an 8 ms 4 kHz transient (its own bank, skipped beyond
// TRANSIENT_RANGE), a band-passed body, a sine thump, a tail, and the
// mechanism (bolt, slide, pump). Each also slaps back off the quarry.
export const GUNSHOTS = {
  rifle: { level: -7, n: 4, drive: 2, slap: true, layers: {
    body: { src: 'noise', mode: 'bp', f: 2200, q: 0.9, a: 0.0006, dur: 0.13 },
    thump: { src: 'sine', f: 90, f1: 45, sweep: 0.12, a: 0.001, dur: 0.12, g: 0.9 },
    tail: { src: 'noise', mode: 'lp', f: 2000, f1: 350, glide: 0.12, a: 0.006, d: 0.1, g: 0.3 },
    bolt: { src: 'noise', mode: 'bp', f: 3200, q: 3, at: 0.05, a: 0.0005, d: 0.006, g: 0.15 },
  } },
  pistol: { level: -9, n: 4, drive: 1.8, slap: true, layers: {
    body: { src: 'noise', mode: 'bp', f: 3200, q: 1.1, a: 0.0004, dur: 0.08 },
    thump: { src: 'sine', f: 90, f1: 45, sweep: 0.12, a: 0.001, dur: 0.12, g: 0.7 },
    tail: { src: 'noise', mode: 'lp', f: 2600, f1: 500, glide: 0.08, a: 0.004, d: 0.07, g: 0.22 },
    slide: { src: 'noise', mode: 'bp', f: 3800, q: 3, at: 0.04, a: 0.0005, d: 0.005, g: 0.18 },
  } },
  shotgun: { level: -5, n: 3, drive: 2.5, slap: true, layers: {
    body: { src: 'noise', mode: 'bp', f: 900, q: 0.6, a: 0.001, dur: 0.3 },
    thump: { src: 'sine', f: 70, f1: 35, sweep: 0.18, a: 0.002, dur: 0.18 },
    tail: { src: 'noise', mode: 'lp', f: 1300, f1: 250, glide: 0.2, a: 0.01, d: 0.2, g: 0.35 },
    pumpBack: { src: 'noise', mode: 'bp', f: 1700, q: 2, at: 0.42, a: 0.002, d: 0.022, g: 0.16 },
    pumpFwd: { src: 'noise', mode: 'bp', f: 2600, q: 2.5, at: 0.55, a: 0.001, d: 0.016, g: 0.2 },
  } },
  // A Bolt shot (§4.8): a square wave diving 1.9 kHz → 350 Hz over 140 ms, and crackle.
  bolt: { level: -8, n: 3, drive: 1.5, slap: true, layers: {
    zap: { src: 'sine', f: 1900, f1: 350, sweep: 0.14, a: 0.0005, dur: 0.14, partials: SQUARE },
    crackle: { src: 'noise', mode: 'bp', f: 3500, q: 0.8, density: 0.12, a: 0.001, dur: 0.14, g: 0.8 },
  } },
  transient: { level: -22, n: 3, layers: {
    snap: { src: 'noise', mode: 'bp', f: 4000, q: 1.2, a: 0.0003, dur: 0.008 },
  } },
};
export const TRANSIENT_RANGE = 25; // m

// Bullet impacts by surface, and the ricochet whine some of them throw off.
export const IMPACTS = {
  concrete: { level: -17, n: 3, drive: 1.5, layers: {
    crack: { src: 'noise', mode: 'bp', f: 2800, q: 1.2, d: 0.008 },
    thud: { src: 'sine', f: 170, f1: 90, glide: 0.02, a: 0.001, d: 0.025, g: 0.5 },
    debris: { src: 'noise', mode: 'bp', f: 4500, q: 1.5, density: 0.04, at: 0.01, a: 0.01, d: 0.07, g: 0.9 },
  } },
  steel: { level: -18, n: 3, layers: {
    hit: { src: 'noise', mode: 'hp', f: 3000, d: 0.003, g: 0.8 },
    ring: { src: 'sine', f: 1100, d: 0.12, g: 0.6, partials: [[1, 1, 1], [2.756, 0.6, 0.6], [5.404, 0.4, 0.35], [8.933, 0.25, 0.2]] },
  } },
  wood: { level: -17, n: 3, layers: {
    knock: { src: 'noise', mode: 'bp', f: 900, q: 1.4, d: 0.012 },
    body: { src: 'sine', f: 320, f1: 260, glide: 0.03, a: 0.0008, d: 0.03, g: 0.7, partials: [[1, 1, 1], [2.3, 0.4, 0.6]] },
    splinter: { src: 'noise', mode: 'bp', f: 3000, q: 2, density: 0.03, at: 0.005, a: 0.002, d: 0.05, g: 0.7 },
  } },
  flesh: { level: -16, n: 3, layers: {
    slap: { src: 'noise', mode: 'lp', f: 1500, d: 0.015 },
    thump: { src: 'sine', f: 110, f1: 60, glide: 0.03, a: 0.001, d: 0.05, g: 0.8 },
  } },
};
export const RICOCHET = { level: -18, n: 3, vary: 0.15, layers: {
  whine: { src: 'sine', f: 2800, f1: 1100, glide: 0.2, a: 0.01, d: 0.12, fm: [0.5, 0.3] },
  hiss: { src: 'noise', mode: 'bp', f: 4000, f1: 1800, glide: 0.2, q: 4, a: 0.005, d: 0.08, g: 0.3 },
} };
// Chance a hit throws a ricochet, times how grazing it is (0 head-on, 1 parallel),
// and its pitch by surface: steel sings higher, concrete whines lower.
export const RICOCHET_CHANCE = { steel: 0.6, concrete: 0.3 };
export const RICOCHET_RATE = { steel: 1.25, concrete: 0.85 };
export const IMPACTS_PER_SHOT = 3; // a shotgun's 12 pellets play at most this many
export const IMPACT_SCATTER = 0.015; // the extra impacts land up to this much later

// Map surfaces (§2.6): a box's own `surface` wins, else its colour index
// (slab, board, precast, plywood, dock, rust) maps here.
export const SURFACE_BY_COLOR = ['concrete', 'concrete', 'concrete', 'wood', 'concrete', 'steel'];
export const DEFAULT_SURFACE = 'concrete';
const SURFACE_ALIAS = { metal: 'steel' };

// Footsteps (§5): a noise burst band-passed by surface (concrete 1.8 kHz,
// wood 600 Hz, steel 1.2 kHz) over a soft heel strike.
export const FOOTSTEPS = {
  concrete: { level: -20, n: 5, vary: 0.12, layers: {
    heel: { src: 'sine', f: 120, f1: 70, glide: 0.015, a: 0.001, d: 0.015, g: 0.5 },
    scuff: { src: 'noise', mode: 'bp', f: 1800, q: 1, a: 0.002, d: 0.018 },
    grit: { src: 'noise', mode: 'hp', f: 4000, density: 0.08, at: 0.008, a: 0.002, d: 0.025, g: 0.3 },
  } },
  wood: { level: -20, n: 5, vary: 0.12, layers: {
    heel: { src: 'sine', f: 160, f1: 110, glide: 0.015, a: 0.001, d: 0.02, g: 0.5 },
    hollow: { src: 'sine', f: 240, d: 0.03, g: 0.4, partials: [[1, 1, 1], [2.3, 0.4, 0.6]] },
    scuff: { src: 'noise', mode: 'bp', f: 600, q: 1.2, a: 0.002, d: 0.02 },
  } },
  steel: { level: -20, n: 5, vary: 0.12, layers: {
    heel: { src: 'sine', f: 130, f1: 80, glide: 0.015, a: 0.001, d: 0.015, g: 0.5 },
    clank: { src: 'sine', f: 450, d: 0.04, g: 0.35, partials: [[1, 1, 1], [2.756, 0.5, 0.6], [5.404, 0.3, 0.4]] },
    scuff: { src: 'noise', mode: 'bp', f: 1200, q: 1.2, a: 0.001, d: 0.016 },
  } },
};
// Landing (§5): a 70 Hz thump plus the footstep, scaled by min(1, |vy| / fullVy),
// after at least minAir s aloft.
export const LAND = { minAir: 0.2, fullVy: 6.3, step: 1.4, stepRate: 0.82 };
// Own casings (§5): a 4.2 kHz tink this long after the shot, and a smaller bounce.
export const CASING_DELAY = 0.38;

// Your own confirmations (§5): instant, dry, never jittered, so they read at once.
export const CONFIRMS = {
  hit: { level: -13, dry: true, layers: { // body: a 1.3 kHz tick, 50 ms
    tick: { src: 'sine', f: 1300, a: 0.0005, dur: 0.05, partials: [[1, 1, 1], [2, 0.3, 0.5]] },
    click: { src: 'noise', mode: 'hp', f: 6000, dur: 0.008, g: 0.2 },
  } },
  head: { level: -12, dry: true, layers: { // 1.9 kHz plus a 4.5 kHz tink, 70 ms
    ding: { src: 'sine', f: 1900, a: 0.0005, dur: 0.07, partials: [[1, 1, 1], [2, 0.2, 0.5]] },
    tink: { src: 'sine', f: 4500, a: 0.0003, dur: 0.07, g: 0.7, partials: BELL },
    click: { src: 'noise', mode: 'hp', f: 7000, dur: 0.008, g: 0.2 },
  } },
  shield: { level: -12, dry: true, layers: { // a 2.4 kHz triangle ping, 60 ms
    ping: { src: 'sine', f: 2400, a: 0.0005, dur: 0.06, partials: TRI },
  } },
  kill: { level: -8, dry: true, layers: { // a square ka-chunk 600 → 300 Hz, 40 ms apart, over a 90 Hz thump
    ka: { src: 'sine', f: 600, a: 0.0008, dur: 0.035, partials: SQUARE },
    chunk: { src: 'sine', f: 300, at: 0.04, a: 0.0008, dur: 0.06, partials: SQUARE },
    thump: { src: 'sine', f: 90, a: 0.002, dur: 0.16, g: 1.2 },
  } },
  hurt: { level: -10, dry: true, layers: {
    thud: { src: 'sine', f: 95, f1: 45, glide: 0.04, a: 0.001, d: 0.07 },
    smack: { src: 'noise', mode: 'lp', f: 700, d: 0.025, g: 0.6 },
  } },
  death: { level: -7, dry: true, layers: {
    boom: { src: 'sine', f: 120, f1: 32, glide: 0.15, a: 0.002, d: 0.35 },
    rumble: { src: 'noise', mode: 'lp', f: 500, f1: 120, glide: 0.3, a: 0.01, d: 0.4, g: 0.5 },
  } },
  respawn: { level: -15, dry: true, layers: {
    rise: { src: 'noise', mode: 'bp', f: 300, f1: 2500, glide: 0.15, q: 1.2, a: 0.08, d: 0.12, g: 0.6 },
    tone: { src: 'sine', f: 440, f1: 880, glide: 0.1, a: 0.05, d: 0.12, g: 0.3 },
  } },
};
export const KILL_STREAK = { window: 6, semitones: 2, max: 4 }; // kills this close climb in pitch

// Menu and match sounds.
export const UI_SOUNDS = {
  click: { level: -27, dry: true, layers: {
    blip: { src: 'sine', f: 1800, f1: 1500, glide: 0.008, a: 0.0003, d: 0.008 },
    tick: { src: 'noise', mode: 'hp', f: 5000, d: 0.001, g: 0.4 },
  } },
  start: { level: -13, dry: true, layers: {
    c: { src: 'sine', f: 523.25, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    e: { src: 'sine', f: 659.25, at: 0.09, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    g: { src: 'sine', f: 783.99, at: 0.18, a: 0.004, d: 0.3, partials: TRI },
  } },
  win: { level: -12, dry: true, layers: {
    c: { src: 'sine', f: 523.25, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    e: { src: 'sine', f: 659.25, at: 0.1, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    g: { src: 'sine', f: 783.99, at: 0.2, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    c2: { src: 'sine', f: 1046.5, at: 0.3, a: 0.004, d: 0.35, partials: TRI },
  } },
  lose: { level: -13, dry: true, layers: {
    g: { src: 'sine', f: 392, a: 0.004, d: 0.2, g: 0.9, partials: TRI },
    eb: { src: 'sine', f: 311.13, at: 0.18, a: 0.004, d: 0.35, partials: TRI },
  } },
  error: { level: -16, dry: true, layers: {
    buzz: { src: 'sine', f: 180, fm: [1, 2.5], a: 0.002, d: 0.04 },
    again: { src: 'sine', f: 180, fm: [1, 2.5], at: 0.09, a: 0.002, d: 0.05 },
  } },
};

// Power-ups (§4.8). Pickups: three sines 40 ms apart, root by item, then a
// major third and a fifth above, each down 40 dB after 250 ms.
export const PICK_ROOTS = { shunt: 523, bolt: 587, barge: 659, shock: 698, mine: 784, nitro: 880, shield: 988, other: 1047 };
const pickup = (root) => ({ level: -12, vary: 0, layers: {
  root: { src: 'sine', f: root, a: 0.002, dur: 0.25, partials: CHIME },
  third: { src: 'sine', f: root * semis(4), at: 0.04, a: 0.002, dur: 0.25, partials: CHIME },
  fifth: { src: 'sine', f: root * semis(7), at: 0.08, a: 0.002, dur: 0.25, partials: CHIME },
} });
// Each item's own sounds, named power.<kind>.<phase>. A known kind with no
// sound for a phase stays silent there: Bolt's use is its three shots
// (gunshot('bolt')), and Barge's wave plays on use, so its boom is silent.
export const POWER_SOUNDS = {
  ...Object.fromEntries(Object.entries(PICK_ROOTS).map(([k, root]) => [`pick.${k}`, pickup(root)])),
  'shunt.use': { level: -11, slap: true, layers: { // launch: band-passed noise 900 → 2200 Hz over 0.4 s
    pop: { src: 'noise', mode: 'lp', f: 900, a: 0.001, dur: 0.04, g: 0.7 },
    rush: { src: 'noise', mode: 'bp', f: 900, f1: 2200, sweep: 0.4, q: 1.5, a: 0.03, dur: 0.4 },
  } },
  'shunt.hiss': { level: -14, loop: 1, layers: { // flight, looped where the rocket is: well over the wind at 8 m
    hiss: { src: 'noise', mode: 'bp', f: 2000, q: 1.5, am: [9, 0.3] },
    roar: { src: 'noise', mode: 'lp', f: 400, g: 0.5 },
  } },
  'shunt.lock': { level: -12, dry: true, vary: 0, layers: { // a 1.6 kHz beep, 30 ms
    beep: { src: 'sine', f: 1600, a: 0.001, dur: 0.03, partials: [[1, 1, 1], [3, 0.15, 1]] },
  } },
  'shunt.boom': { level: -1, drive: 2.5, send: 1.6, slap: true, layers: {
    crack: { src: 'noise', mode: 'hp', f: 2000, d: 0.006, g: 0.8 },
    boom: { src: 'sine', f: 80, f1: 28, glide: 0.12, a: 0.003, d: 0.3 },
    body: { src: 'noise', mode: 'lp', f: 1500, f1: 120, glide: 0.3, a: 0.005, d: 0.35, g: 0.9 },
    debris: { src: 'noise', mode: 'bp', f: 2500, q: 1, density: 0.02, at: 0.12, a: 0.05, d: 0.3, g: 0.5 },
  } },
  'barge.use': { level: -5, drive: 2, slap: true, layers: { // a 45 Hz sub and a 300 → 80 Hz whomp, 350 ms
    sub: { src: 'sine', f: 45, a: 0.01, dur: 0.35 },
    whomp: { src: 'sine', f: 300, f1: 80, sweep: 0.3, a: 0.004, dur: 0.35, g: 0.9, partials: [[1, 1, 1], [2, 0.3, 0.7]] },
    air: { src: 'noise', mode: 'lp', f: 900, f1: 200, sweep: 0.3, a: 0.01, dur: 0.35, g: 0.5 },
  } },
  'shock.use': { level: -16, layers: { // the telegraph whine, 400 → 1600 Hz over 1.2 s
    whine: { src: 'sine', f: 400, f1: 1600, sweep: 1.2, a: 1.1, dur: 1.2, am: [14, 0.5], partials: [[1, 1, 1], [2, 0.35, 1], [3, 0.15, 1]] },
  } },
  'shock.boom': { level: -8, drive: 2, slap: true, layers: { // strike: 3 kHz noise 80 ms and a 110 Hz buzz 300 ms
    crack: { src: 'noise', mode: 'bp', f: 3000, q: 0.7, a: 0.0005, dur: 0.08 },
    buzz: { src: 'sine', f: 110, a: 0.002, dur: 0.3, g: 0.8, partials: SAW },
  } },
  'mine.use': { level: -16, layers: { // drop: a 200 Hz clunk, 60 ms
    clunk: { src: 'sine', f: 200, a: 0.001, dur: 0.06, partials: [[1, 1, 1], [2.76, 0.4, 0.6], [5.4, 0.2, 0.4]] },
    knock: { src: 'noise', mode: 'lp', f: 1200, a: 0.0005, dur: 0.03, g: 0.6 },
  } },
  'mine.arm': { level: -20, vary: 0, layers: { // a 2 kHz click, 15 ms
    click: { src: 'sine', f: 2000, a: 0.0005, dur: 0.015, partials: [[1, 1, 1], [2, 0.3, 1]] },
  } },
  'mine.fuse': { level: -12, vary: 0, layers: { // beeps at 8 Hz through the 0.25 s fuse
    b0: { src: 'sine', f: 2600, a: 0.001, dur: 0.05, partials: SQUARE },
    b1: { src: 'sine', f: 2600, at: 0.125, a: 0.001, dur: 0.05, partials: SQUARE },
    b2: { src: 'sine', f: 2600, at: 0.25, a: 0.001, dur: 0.05, partials: SQUARE },
  } },
  'mine.boom': { level: -5, drive: 2.5, send: 1.6, slap: true, layers: { // noise low-passed at 600 Hz for 0.5 s, a 50 Hz thump
    body: { src: 'noise', mode: 'lp', f: 600, a: 0.002, dur: 0.5 },
    thump: { src: 'sine', f: 50, a: 0.003, dur: 0.4 },
    crack: { src: 'noise', mode: 'hp', f: 2500, dur: 0.02, g: 0.5 },
  } },
  'nitro.use': { level: -12, layers: { // a sawtooth spool 220 → 660 Hz over 300 ms through a lowpass
    spool: { src: 'sine', f: 220, f1: 660, sweep: 0.3, a: 0.05, dur: 0.3, partials: SAW_LP },
    whoosh: { src: 'noise', mode: 'bp', f: 500, f1: 2500, sweep: 0.3, q: 1, a: 0.08, dur: 0.3, g: 0.4 },
  } },
  'shield.use': { level: -12, vary: 0, layers: { // on: a 1.2 / 1.8 / 2.4 kHz shimmer, 400 ms
    a: { src: 'sine', f: 1200, a: 0.01, dur: 0.4, am: [18, 0.6] },
    b: { src: 'sine', f: 1800, a: 0.02, dur: 0.4, am: [23, 0.6], g: 0.8 },
    c: { src: 'sine', f: 2400, a: 0.03, dur: 0.4, am: [29, 0.6], g: 0.6 },
  } },
  'shield.break': { level: -11, layers: { // noise high-passed at 4 kHz, 200 ms
    shatter: { src: 'noise', mode: 'hp', f: 4000, a: 0.0005, dur: 0.2 },
    tinkle: { src: 'noise', mode: 'bp', f: 7000, q: 3, density: 0.1, a: 0.001, dur: 0.2, g: 0.6 },
  } },
  fizzle: { level: -16, layers: { // noise low-passed at 800 Hz, 150 ms
    fizz: { src: 'noise', mode: 'lp', f: 800, a: 0.002, dur: 0.15 },
  } },
  use: { level: -14, layers: { // any other item's use
    whoosh: { src: 'noise', mode: 'bp', f: 250, f1: 3000, glide: 0.15, q: 1.2, a: 0.08, d: 0.1 },
    air: { src: 'noise', mode: 'lp', f: 500, a: 0.05, d: 0.12, g: 0.3 },
  } },
  hum: { level: -32, vary: 0, loop: 1, layers: { // a pad's 110 Hz hum
    hum: { src: 'sine', f: 110, partials: [[1, 1, 1], [2, 0.25, 1]], am: [1, 0.15] },
  } },
};
// Kinds with no sound of their own (the engine's Repair) borrow these.
const POWER_FALLBACK = { pick: 'power.pick.other', use: 'power.use', boom: 'power.shunt.boom' };
const BOLT_HIT = 'impact.steel'; // the engine wave's Bolt projectile landing
export const LOCK = { range: 40, slow: 3, fast: 9, lookahead: 0.05, cone: 30, chest: 1 }; // beeps/s from range m in to 0 m; cone °, chest m
export const SHOCK_TARGET = 2; // the whine at your feet plays this much louder
export const HUM_RANGE = 8; // m: the two nearest pads hum, fading out by here
export const HUM_EVERY = 6; // snapshots between pad hum updates
export const HOLD = { fade: 0.06, gone: 0.005, timeout: 0.35 }; // loop fade time constants: a loop not refreshed for timeout s fades; a Shunt that is gone cuts at once

// The quarry's wind bed (§5): noise band-passed 300–600 Hz, its level
// swaying ±sway on a 0.1 Hz LFO.
export const WIND = { level: -30, lfo: 0.1, sway: 0.4, band: [300, 600], fade: 1.5 };
const WIND_SOUND = { level: WIND.level, loop: 4, layers: {
  wind: { src: 'noise', mode: 'bp', f: Math.sqrt(WIND.band[0] * WIND.band[1]), q: 1.4 },
} };

// Mix (§5): buses, master, compressor, slapback, reverb, distance, ducking.
export const MIX = { master: 0.6, sfx: 1, confirm: 1, reverb: 0.6 };
export const COMPRESSOR = { threshold: -12, knee: 6, ratio: 4, attack: 0.003, release: 0.12 };
// The quarry slapback: one shared delay, low-passed, this many dB under the dry sound.
export const SLAP = { delay: 0.18, db: -14, cutoff: 1500 };
// The last stage, a soft clipper: untouched below knee, then bending toward
// ceiling (-1 dBFS), so a pile-up can never clip. Inputs up to ±range are shaped.
export const CLIP = { knee: 0.6, ceiling: 0.89, range: 4 };
export const REVERB = { seconds: 1.5, rt60: 1.2, predelay: 0.01, early: 10, earlySpread: 0.06, earlyGain: 0.4, bright: 8000, dark: 900 };
// Others are quieter (half the level at halfGainDist), darker and relatively
// wetter with distance, and culled past maxDist.
export const SPACE = { halfGainDist: 10, cutoffNear: 18000, cutoffHalfDist: 18, cutoffFar: 1200, panWidth: 0.8, wet: 0.25, maxDist: 90 };
export const DUCK = { kill: 0.35, hurt: 0.25, boom: 0.5, attack: 0.005, hold: 0.06, release: 0.15 }; // dips the world under big moments
export const MUFFLE = { open: 20000, dead: 650, time: 0.2 }; // the world goes dull while you are dead
export const JITTER = { rate: 0.035, gain: 0.12 }; // ± per play, on top of the variants
export const VOICE_LIMIT = 48; // one-shots and loops at once; the oldest is stolen
export const VARY = 0.06;
export const PEAK = 0.9; // every rendered sound peaks here, before its level

/* ---------------------------------------------------------------------------
 * DSP: pure, seeded, and run once at start().
 * ------------------------------------------------------------------------ */
const TAU = 2 * Math.PI;
const SEED = 0x5eed;
const TAIL = Math.log(100); // buffers run until their longest layer is down 40 dB; the reverb carries the rest
const LOOP_XFADE = 0.05;
const FADE_OUT = 0.004;

// Every sound by name ('gun.rifle', 'power.mine.boom', …), in the order
// start() renders them: the ones a fight needs first.
const group = (prefix, sounds) => Object.fromEntries(Object.entries(sounds).map(([k, v]) => [`${prefix}.${k}`, v]));
export const SOUNDS = {
  ...group('confirm', CONFIRMS), ...group('gun', GUNSHOTS), ...group('impact', IMPACTS), ...group('step', FOOTSTEPS),
  land: { level: -16, n: 2, layers: { thump: { src: 'sine', f: 70, f1: 50, sweep: 0.1, a: 0.002, dur: 0.16 } } },
  casing: { level: -26, n: 3, vary: 0.04, layers: {
    tink: { src: 'sine', f: 4200, a: 0.0002, dur: 0.06, partials: BELL },
    bounce: { src: 'sine', f: 4200, at: 0.09, a: 0.0002, dur: 0.04, g: 0.4, partials: BELL },
  } },
  ricochet: RICOCHET, ...group('power', POWER_SOUNDS), ...group('ui', UI_SOUNDS), wind: WIND_SOUND,
};

// FNV-1a: a stable number per name, so adding a sound reshuffles no other.
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A sine table, so the sample loops skip Math.sin: sin(x) for any x, to 1e-6.
const SIN_N = 4096;
const SIN = Float64Array.from({ length: SIN_N + 1 }, (_, i) => Math.sin((TAU * i) / SIN_N));
const sin = (x) => {
  let u = x * (SIN_N / TAU);
  u -= Math.floor(u / SIN_N) * SIN_N;
  const i = u | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (u - i);
};
const tremolo = (am, t) => (am ? 1 - am[1] * (0.5 + 0.5 * sin(TAU * am[0] * t)) : 1);

// The shared inner loop: a linear attack, then an exponential decay (or held
// at 1 for loops), and a frequency moving from f toward f1: a log sweep that
// lands at `sweep` s, or an exponential glide. Both run as per-sample
// multiplies; each layer stops once below -60 dB. sample(f, t) returns the
// raw source at frequency f and time t; the envelope and gain are applied here.
function addLayer(out, l, fs, held, gain, decay, sample) {
  const start = Math.round(l.at * fs);
  const attack = Math.max(1, Math.round(l.a * fs));
  const fall = Math.exp(-1 / (decay * fs));
  const target = l.f1 ?? l.f;
  const sweepN = l.f1 !== undefined && l.sweep ? Math.max(1, Math.round(l.sweep * fs)) : 0;
  const k = sweepN ? (target / l.f) ** (1 / sweepN) : l.f1 === undefined ? 1 : Math.exp(-1 / (l.glide * fs));
  let f = l.f; // the swept frequency
  let dev = l.f - target; // the glide's distance still to go
  let e = 0;
  for (let i = start, j = 0; i < out.length; i++, j++) {
    if (held) e = 1;
    else if (j < attack) e = j / attack;
    else if ((e = j === attack ? 1 : e * fall) < 1e-3) break;
    out[i] += sample(sweepN ? f : target + dev, j / fs) * e * gain;
    if (sweepN) f = j < sweepN ? f * k : target;
    else dev *= k;
  }
}

// Filtered noise through a TPT state-variable filter (Zavalishin), which
// stays stable at any cutoff, even swept; a swept cutoff is updated every
// 8 samples.
function addNoise(out, l, fs, rand, held) {
  const k = 1 / (l.q ?? Math.SQRT1_2);
  const mode = l.mode === 'lp' ? 0 : l.mode === 'hp' ? 2 : 1;
  let s1 = 0;
  let s2 = 0;
  let g = 0;
  let n = 0;
  addLayer(out, l, fs, held, l.g, l.d, (f, t) => {
    if (n++ % 8 === 0) g = Math.tan((Math.PI * Math.min(f, fs * 0.45)) / fs);
    const x = l.density === undefined || rand() < l.density ? rand() * 2 - 1 : 0;
    const hp = (x - (k + g) * s1 - s2) / (1 + g * (k + g));
    const bp = g * hp + s1;
    const lp = g * bp + s2;
    s1 = g * hp + bp;
    s2 = g * bp + lp;
    return (mode === 0 ? lp : mode === 2 ? hp : k * bp) * tremolo(l.am, t); // k·bp peaks at unity
  });
}

// Sine partials, each with its own decay, all following the pitch glide.
// Yields after each partial.
function* addSine(out, l, fs, held) {
  const top = Math.max(l.f, l.f1 ?? 0);
  for (const [ratio, pg, pd] of l.partials ?? [[1, 1, 1]]) {
    if (top * ratio >= fs * 0.45) continue;
    let ph = 0;
    let mph = 0;
    addLayer(out, l, fs, held, l.g * pg, l.d * pd, (f, t) => {
      const x = sin(ph + (l.fm ? l.fm[1] * sin(mph) : 0));
      if ((ph += (TAU * f * ratio) / fs) > TAU) ph -= TAU;
      if (l.fm && (mph += (TAU * f * ratio * l.fm[0]) / fs) > TAU) mph -= TAU;
      return x * tremolo(l.am, t);
    });
    yield;
  }
}

// One variant of a recipe as mono samples at fs; rand jitters the layers.
export function renderSound(recipe, fs, rand) {
  const steps = renderSteps(recipe, fs, rand);
  let s = steps.next();
  while (!s.done) s = steps.next();
  return s.value;
}

// renderSound in steps, yielding after each noise layer and sine partial,
// so start() can spread one long sound over several tasks.
function* renderSteps(recipe, fs, rand) {
  const vary = recipe.vary ?? VARY;
  const jit = (v) => v * (1 + (rand() * 2 - 1) * vary);
  const layers = Object.values(recipe.layers).map((l) => {
    const a = Math.max(l.a ?? 0, 2 / fs);
    const d = l.dur === undefined ? l.d ?? 1 : Math.max(1 / fs, (l.dur - a) / TAIL);
    return { ...l, at: l.at ?? 0, a, d: jit(d), g: jit(l.g ?? 1), f: jit(l.f), f1: l.f1 === undefined ? undefined : jit(l.f1) };
  });
  const held = !!recipe.loop;
  const seconds = held ? recipe.loop + LOOP_XFADE
    : Math.max(...layers.map((l) => l.at + l.a + l.d * TAIL * Math.max(...(l.partials ?? [[1, 1, 1]]).map((p) => p[2]))));
  let out = new Float32Array(Math.ceil(seconds * fs));
  for (const l of layers) {
    if (l.src !== 'noise') yield* addSine(out, l, fs, held);
    else {
      addNoise(out, l, fs, rand, held);
      yield;
    }
  }
  if (held) {
    // Crossfade the overhang into the head, so the end runs into the start.
    const n = Math.round(recipe.loop * fs);
    const x = out.length - n;
    for (let i = 0; i < x; i++) out[i] = out[i] * (i / x) + out[n + i] * (1 - i / x);
    out = out.slice(0, n);
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const drive = recipe.drive ?? 1;
  const norm = drive > 1 ? 1 / Math.tanh(drive) : 1;
  for (let i = 0; i < out.length; i++) {
    const x = peak ? out[i] / peak : 0;
    out[i] = PEAK * (drive > 1 ? Math.tanh(drive * x) * norm : x);
  }
  if (!held) {
    const fade = Math.min(out.length, Math.round(FADE_OUT * fs));
    for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

// Short-term level: the loudest 50 ms RMS (a loop's whole length), +3 dB so
// a full-scale sine reads 1 (0 dB). A recipe's `level` sets this, so its gain
// is level / shortTerm.
export function shortTerm(buf, fs, seconds = 0.05) {
  const w = Math.min(buf.length, Math.max(1, Math.round(seconds * fs)));
  let acc = 0;
  let best = 0;
  for (let i = 0; i < buf.length; i++) {
    acc += buf[i] * buf[i];
    if (i >= w) acc -= buf[i - w] * buf[i - w];
    if (acc > best) best = acc;
  }
  return Math.sqrt((2 * best) / w);
}
export const dbToGain = (db) => 10 ** (db / 20);

// A stereo room: early reflections, then exponentially decaying noise that
// darkens as it fades (high frequencies die first). Each channel rolls its
// own noise, so the tail is wide.
export function renderIR(fs, r, rand) {
  const n = Math.round(r.seconds * fs);
  const pre = Math.round(r.predelay * fs);
  return [0, 1].map(() => {
    const ch = new Float32Array(n);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / fs;
      const fc = r.dark + (r.bright - r.dark) * Math.exp((-4 * t) / r.rt60);
      lp += (1 - Math.exp((-TAU * fc) / fs)) * (rand() * 2 - 1 - lp);
      ch[i] = lp * Math.exp((-6.9 * t) / r.rt60) * Math.min(1, (n - i) / (0.05 * fs));
    }
    for (let e = 0; e < r.early; e++) {
      ch[pre + Math.floor(rand() * r.earlySpread * fs)] += (rand() < 0.5 ? -1 : 1) * r.earlyGain * (1 - e / r.early);
    }
    return ch;
  });
}

// The output soft clipper as a WaveShaper curve over inputs -range..range:
// the identity up to knee, then a tanh bend toward ceiling, never reaching it.
export function clipCurve(n, knee, range, ceiling = 1) {
  return Float32Array.from({ length: n }, (_, i) => {
    const x = ((2 * i) / (n - 1) - 1) * range;
    const a = Math.abs(x);
    return Math.sign(x) * (a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  });
}

/* ---------------------------------------------------------------------------
 * Space, surfaces and game state: pure.
 * ------------------------------------------------------------------------ */
// Distance in metres → level, lowpass cutoff and reverb send of a voice.
export const distGain = (d) => 1 / (1 + d / SPACE.halfGainDist);
export const distCutoff = (d) => Math.max(SPACE.cutoffFar, SPACE.cutoffNear / (1 + d / SPACE.cutoffHalfDist));
export const wetSend = (d) => SPACE.wet * Math.sqrt(distGain(d)); // falls slower than the dry level

// A locked Shunt's beeps per second at distance d: slow at LOCK.range, fast at 0.
export const beepRate = (d) => LOCK.slow + (LOCK.fast - LOCK.slow) * (1 - Math.min(1, Math.max(0, d / LOCK.range)));

// The lock beeps warn('lock') wants for you at feet me ({ x, y, z }), from
// the entities (readEntities): the nearest enemy Shunt within LOCK.range
// locked on you, else 0. The bible's rows name the Shunt's target; the
// engine wave's carry none (target null), so a Shunt heading within
// LOCK.cone of your chest counts as locked there.
const LOCK_COS = Math.cos((LOCK.cone * Math.PI) / 180);
export function lockRate(list, me, myId) {
  let near = Infinity;
  for (const e of list) {
    if (e.kind !== 'shunt' || e.owner === myId) continue;
    const dx = me.x - e.x;
    const dy = me.y + LOCK.chest - e.y;
    const dz = me.z - e.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= near || d > LOCK.range) continue;
    const v = Math.hypot(e.vx, e.vy, e.vz);
    if (e.target != null ? e.target !== 0 && e.target === myId : v > 0 && dx * e.vx + dy * e.vy + dz * e.vz >= LOCK_COS * d * v) near = d;
  }
  return near < Infinity ? beepRate(near) : 0;
}

// The `pu` snapshot's entities from either wire, as [{ id, kind, owner, x,
// y, z, vx, vy, vz, state, target }], reusing out's objects:
// - the bible's (§4.5) en rows [eid, type, owner, x, y, z, a, b], type an
//   ENT value: a Shunt's a is its target (0 none), a Mine's a its state
//   (0 arming, 1 armed, 2 fused), a Dome's b its target;
// - the engine wave's ents rows (entityTuple), which have velocity and an
//   armed flag but no target (null).
const ENT_KINDS = Object.fromEntries(Object.entries(wire.ENT).map(([k, v]) => [v, k.toLowerCase()]));
export function readEntities(pu, out = []) {
  const bible = !!pu.en;
  const rows = (bible ? pu.en : pu.ents) ?? [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const e = (out[i] ??= {});
    e.id = r[0];
    e.owner = r[2];
    e.x = r[3];
    e.y = r[4];
    e.z = r[5];
    if (bible) {
      e.kind = ENT_KINDS[r[1]];
      e.vx = e.vy = e.vz = 0;
      e.state = e.kind === 'mine' ? r[6] : 0;
      e.target = e.kind === 'shunt' ? r[6] : e.kind === 'dome' ? r[7] : null;
    } else {
      e.kind = wire.POWERUP_IDS?.[r[1]];
      e.vx = r[6];
      e.vy = r[7];
      e.vz = r[8];
      e.state = r[9] & 1 ? 1 : 0; // ENTITY_FLAGS.ARMED
      e.target = null;
    }
  }
  out.length = rows.length;
  return out;
}

// Your own use on the engine wave's wire: the slot that shared/powerups.js
// stepPowerups will use for these keys, from the slots before the step, or
// null. On the bible's wire there is no self.inv (inv undefined): there
// client/powerups.js cast() plays your use (§8.9 row 9).
export const usedSlot = (inv, keys) => (Array.isArray(inv) && keys & KEY.USE && inv.length ? inv[keys & KEY.CYCLE && inv.length > 1 ? 1 : 0] : null);

const surfaceOf = (s) => SURFACE_ALIAS[s] ?? s;

// Map JSON → boxes ({ min, max, surface }), in map order.
export function surfacesOf(map) {
  return prepareMap(map).boxes.map((b, i) => ({ ...b, surface: surfaceOf(map.boxes[i].surface ?? SURFACE_BY_COLOR[map.boxes[i].color] ?? DEFAULT_SURFACE) }));
}

// What a shot from origin that ended at end ([x, y, z]) hit: { surface, axis }
// for a box face (axis: 0 x, 1 y, 2 z, the face normal's axis); 'flesh' when
// it stopped short of every box, which only a player can do; null when it flew
// out to SHOT_RANGE. The host rounds ends to 1 mm, hence the tolerance.
const ON_FACE = 0.01;
export function classify(origin, end, surfaces) {
  if (Math.hypot(end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]) > SHOT_RANGE - 0.05) return null;
  for (const s of surfaces) {
    let axis = -1;
    let best = ON_FACE;
    for (let a = 0; a < 3; a++) {
      if (end[a] < s.min[a] - ON_FACE || end[a] > s.max[a] + ON_FACE) { axis = -2; break; }
      const face = Math.min(Math.abs(end[a] - s.min[a]), Math.abs(end[a] - s.max[a]));
      if (face < best) [best, axis] = [face, a];
    }
    if (axis >= 0) return { surface: s.surface, axis };
  }
  return { surface: 'flesh', axis: -1 };
}

// The surface under a player's feet ({ x, y, z }, y at the soles).
export function surfaceUnder(p, surfaces) {
  for (const s of surfaces) {
    if (Math.abs(s.max[1] - p.y) < 0.05 && p.x >= s.min[0] && p.x <= s.max[0] && p.z >= s.min[2] && p.z <= s.max[2]) return s.surface;
  }
  return DEFAULT_SURFACE;
}

// A random variant other than the last one played, so nothing machine-guns.
export function pickVariant(n, last, rand = Math.random) {
  if (n < 2) return 0;
  const i = Math.floor(rand() * (last < 0 ? n : n - 1));
  return last >= 0 && i >= last ? i + 1 : i;
}

// Which playing voice ({ pri }, oldest first) to stop so one more of
// priority pri fits under limit: -1 when there is room, null when every
// voice outranks it (it is dropped), else the oldest voice it may replace.
export function voiceToSteal(voices, pri, limit) {
  if (voices.length < limit) return -1;
  const i = voices.findIndex((v) => v.pri <= pri);
  return i < 0 ? null : i;
}

// Power-up entities since the last snapshot. list: [{ id, kind, state }]
// with state 0 arming, 1 armed, 2 fused (or armed: bool); seen carries ids
// between calls. on(what, e): 'fly' for every Shunt in the air, 'arm' and
// 'fuse' when a mine changes state, 'new' on first sight of any other kind,
// and 'gone' ({ id }) once an entity is no longer listed.
export function diffEntities(seen, list, on) {
  for (const e of list) {
    const state = e.state ?? (e.armed ? 1 : 0);
    const was = seen.get(e.id);
    if (e.kind === 'shunt') on('fly', e);
    else if (e.kind === 'mine') {
      if (was !== undefined && state > was) on(state === 1 ? 'arm' : 'fuse', e);
    } else if (was === undefined) on('new', e);
    seen.set(e.id, state);
  }
  if (seen.size > list.length) {
    for (const id of seen.keys()) {
      if (list.some((e) => e.id === id)) continue;
      seen.delete(id);
      on('gone', { id });
    }
  }
}

/* ---------------------------------------------------------------------------
 * Runtime.
 * ------------------------------------------------------------------------ */
let ctx = null; // set last in init(), so every export stays a no-op until audio fully works
let out; // master gain → soft clipper → speakers
let sfx; // the world: ducked, muffled while dead
let loud; // blasts: muffled while dead, but never ducked, not even by themselves
let confirm; // your own feedback and UI: dry and never ducked
let send; // → the convolution reverb
let slap; // → the quarry slapback
let muffle;
let ready = Promise.resolve(); // the banks, rendered after start()
const banks = {}; // name → { bufs, gains, last, send, slap, exact, dry }
const active = []; // playing one-shots, oldest first: { src, g, pri }
const loops = new Map(); // held loops by key: { src, g, p, seen, level, pan }
const ents = new Map(); // power-up entity id → state
let wind = null;
let surfaces = [];
let volume = 1;
let renderMs = 0;
let warned = false;
let streak = 0;
let lastKill = -Infinity;
let airSince = -1;
let fallVy = 0;
let nextBeep = 0;
let shockOn = false;
let mapId = null; // for the engine wave's pads
let predicted = 0; // own uses played on prediction whose echo has not come back
let humTick = 0;
let shieldWas = 0;
const rows = []; // readEntities' reused objects
const hums = []; // padHums' reused list

const PRI = { step: 0, impact: 1, world: 2, gun: 3, self: 4 };
const finite = (v) => (Number.isFinite(v) ? v : 0);
const clampPan = (p) => Math.max(-1, Math.min(1, finite(p))) * SPACE.panWidth;
const jitter = (amount) => 1 + amount * (Math.random() * 2 - 1);

function fail(e) {
  if (!warned) console.warn('audio:', e);
  warned = true;
}

// Every export goes through here: silent until started, and never throws.
const safe = (fn) => (...args) => {
  if (!ctx) return;
  try { fn(...args); } catch (e) { fail(e); }
};

function toBuffer(c, channels) {
  const b = c.createBuffer(channels.length, channels[0].length, c.sampleRate);
  channels.forEach((data, i) => b.copyToChannel(data, i));
  return b;
}

function init(c) {
  const t0 = performance.now();
  // speakers ← clip ← master ← compressor ← muffle ← sfx (world) and the returns; confirm skips the muffle.
  out = c.createGain();
  out.gain.value = MIX.master * volume;
  const pre = c.createGain();
  pre.gain.value = 1 / CLIP.range; // the curve spans ±range
  const clip = c.createWaveShaper();
  clip.curve = clipCurve(4097, CLIP.knee, CLIP.range, CLIP.ceiling);
  out.connect(pre).connect(clip).connect(c.destination);
  const comp = c.createDynamicsCompressor();
  for (const [k, v] of Object.entries(COMPRESSOR)) comp[k].value = v;
  comp.connect(out);
  muffle = c.createBiquadFilter();
  muffle.frequency.value = MUFFLE.open;
  muffle.connect(comp);
  sfx = c.createGain();
  sfx.gain.value = MIX.sfx;
  sfx.connect(muffle);
  loud = c.createGain();
  loud.gain.value = MIX.sfx;
  loud.connect(muffle);
  confirm = c.createGain();
  confirm.gain.value = MIX.confirm;
  confirm.connect(comp);
  const verb = c.createConvolver();
  const ret = c.createGain();
  ret.gain.value = MIX.reverb;
  send = c.createGain();
  send.connect(verb).connect(ret).connect(muffle);
  slap = c.createDelay(1);
  slap.delayTime.value = SLAP.delay;
  const slapLp = c.createBiquadFilter();
  slapLp.frequency.value = SLAP.cutoff;
  const slapRet = c.createGain();
  slapRet.gain.value = dbToGain(SLAP.db);
  slap.connect(slapLp).connect(slapRet).connect(muffle);
  renderMs = performance.now() - t0;
  ctx = c;
  ready = renderBanks(c, verb);
  setInterval(safe(watchLoops), 100);
  document.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('button')) ui('click'); });
  const q = new URLSearchParams(location.search);
  if (q.has('debug') && q.has('sfx')) ready.then(() => { ambience(true); playBoard(); });
}

// Rendering every variant takes a second or two of CPU, so it runs in
// slices of about SLICE_MS, split between sine partials and noise layers:
// the longest single step is one partial of a 2 s sound. A sound plays once
// its bank is in.
const SLICE_MS = 8;
async function renderBanks(c, verb) {
  try {
    await new Promise((resolve) => setTimeout(resolve)); // start() runs inside a click
    const t0 = performance.now();
    const ir = toBuffer(c, renderIR(c.sampleRate, REVERB, shotRng(SEED, hash('reverb'), 0)));
    renderMs += performance.now() - t0;
    await new Promise((resolve) => setTimeout(resolve));
    verb.buffer = ir; // a task of its own: the convolver's setup is native, about 40 ms. Silent until then.
    let slice = Infinity;
    for (const [name, r] of Object.entries(SOUNDS)) {
      const bufs = [];
      const gains = [];
      for (let v = 0; v < (r.n ?? 1); v++) {
        const steps = renderSteps(r, c.sampleRate, shotRng(SEED, hash(name), v));
        let s;
        do {
          if (slice > SLICE_MS) {
            await new Promise((resolve) => setTimeout(resolve));
            slice = 0;
          }
          const t0 = performance.now();
          s = steps.next();
          if (s.done) {
            bufs.push(toBuffer(c, [s.value]));
            gains.push(dbToGain(r.level ?? -12) / (shortTerm(s.value, c.sampleRate, r.loop) || 1));
          }
          const dt = performance.now() - t0;
          slice += dt;
          renderMs += dt;
        } while (!s.done);
      }
      banks[name] = { bufs, gains, last: -1, send: r.send ?? 1, slap: !!r.slap, dry: !!r.dry, exact: !!r.dry || r.vary === 0 };
    }
  } catch (e) { fail(e); }
}

// given: an OfflineAudioContext, for tests. Returns a promise of the banks.
export function start(given) {
  try {
    if (!ctx) init(given ?? new AudioContext({ latencyHint: 'interactive' }));
    if (ctx.state === 'suspended' && !ctx.startRendering) ctx.resume().catch(() => {});
  } catch (e) {
    ctx = null;
    fail(e);
  }
  return ready;
}

// Room for one more voice: steal the oldest one it outranks if full.
function admit(pri) {
  const i = voiceToSteal(active, pri, VOICE_LIMIT - loops.size);
  if (i === null) return false;
  if (i >= 0) {
    const [v] = active.splice(i, 1);
    const t = ctx.currentTime;
    v.g.gain.setTargetAtTime(0, t, 0.004);
    v.src.stop(t + 0.03);
  }
  return true;
}

// One voice. dist 0 is your own sound: centred, full level, no distance filter.
function play(name, { dist = 0, pan = 0, gain = 1, rate = 1, delay = 0, pri = PRI.world, bus = sfx } = {}) {
  const bank = banks[name];
  dist = finite(dist);
  if (!bank || dist > SPACE.maxDist || !admit(pri)) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  bank.last = pickVariant(bank.bufs.length, bank.last);
  src.buffer = bank.bufs[bank.last];
  src.playbackRate.value = finite(rate * (bank.exact ? 1 : jitter(JITTER.rate))) || 1;
  const level = bank.gains[bank.last] * gain * (bank.exact ? 1 : jitter(JITTER.gain));
  let head = src;
  if (dist > 0) {
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = distCutoff(dist);
    head = src.connect(lp);
  }
  const g = ctx.createGain();
  g.gain.value = finite(level * distGain(dist));
  let tail = head.connect(g);
  if (dist > 0 && pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = clampPan(pan);
    tail = g.connect(p);
  }
  tail.connect(bank.dry ? confirm : bus);
  if (!bank.dry) {
    const w = ctx.createGain();
    w.gain.value = finite(level * wetSend(dist) * bank.send);
    head.connect(w).connect(send);
    if (bank.slap) {
      const s = ctx.createGain();
      s.gain.value = finite(level * Math.sqrt(distGain(dist)));
      head.connect(s).connect(slap);
    }
  }
  const v = { src, g, pri };
  active.push(v);
  src.onended = () => {
    const i = active.indexOf(v);
    if (i >= 0) active.splice(i, 1);
  };
  src.start(t);
}

// A held loop under key: call it every frame (or snapshot) while it should
// sound; it fades out on its own once the calls stop. gain scales its level
// (distance included).
function hold(key, name, gain, pan) {
  const t = ctx.currentTime;
  let l = loops.get(key);
  if (!l) {
    const bank = banks[name];
    if (!bank || active.length + loops.size >= VOICE_LIMIT) return;
    const src = ctx.createBufferSource();
    src.buffer = bank.bufs[0];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = ctx.createStereoPanner();
    src.connect(g).connect(p).connect(sfx);
    src.start(t);
    l = { src, g, p, seen: t, level: -1, pan: 0, base: bank.gains[0] };
    loops.set(key, l);
  }
  l.seen = t;
  const level = l.base * finite(gain);
  if (Math.abs(level - l.level) > 0.05 * l.level + 1e-4) l.g.gain.setTargetAtTime((l.level = level), t, HOLD.fade);
  const p = clampPan(pan);
  if (Math.abs(p - l.pan) > 0.02) l.p.pan.setTargetAtTime((l.pan = p), t, 0.03);
}

// Fade a held loop out with time constant tc, then stop it.
function release(key, tc) {
  const l = loops.get(key);
  if (!l) return;
  const t = ctx.currentTime;
  l.g.gain.setTargetAtTime(0, t, tc);
  l.src.stop(t + tc * 8);
  loops.delete(key);
}

// A safety net for loops whose caller went quiet (a stalled snapshot stream).
function watchLoops() {
  const t = ctx.currentTime;
  for (const [key, l] of loops) if (t - l.seen >= HOLD.timeout) release(key, HOLD.fade);
}

// Dip the world for a moment, so a big moment cuts through.
function duck(depth) {
  if (!(depth > 0)) return;
  const t = ctx.currentTime;
  const p = sfx.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.setTargetAtTime(MIX.sfx * (1 - Math.min(1, depth)), t, DUCK.attack);
  p.setTargetAtTime(MIX.sfx, t + DUCK.hold, DUCK.release);
}

function muffleTo(hz) {
  const t = ctx.currentTime;
  muffle.frequency.cancelScheduledValues(t);
  muffle.frequency.setTargetAtTime(hz, t, MUFFLE.time);
}

// --- Weapons and the world. dist in metres, pan from -1 (left) to 1 (right). ---
// weapon: 'rifle' | 'pistol' | 'shotgun' | 'bolt'.
export const gunshot = safe((weapon, dist = 0, pan = 0) => {
  const kind = GUNSHOTS[weapon] && weapon !== 'transient' ? weapon : 'rifle';
  const pri = dist > 0 ? PRI.gun : PRI.self;
  play(`gun.${kind}`, { dist, pan, pri });
  if (kind !== 'bolt' && finite(dist) <= TRANSIENT_RANGE) play('gun.transient', { dist, pan, pri });
});

// A shot's bullet ends ([x, y, z] each) from origin: surface hits and the
// odd ricochet. heard(x, z) → [dist, pan] places each one.
export const impacts = safe((origin, ends, heard) => {
  let played = 0;
  for (const end of ends) {
    if (played >= IMPACTS_PER_SHOT) break;
    const hit = classify(origin, end, surfaces);
    if (!hit) continue;
    const [dist, pan] = heard(end[0], end[2]);
    play(`impact.${IMPACTS[hit.surface] ? hit.surface : DEFAULT_SURFACE}`, { dist, pan, delay: played ? Math.random() * IMPACT_SCATTER : 0, pri: PRI.impact });
    if (!played && hit.axis >= 0) {
      const len = Math.hypot(end[0] - origin[0], end[1] - origin[1], end[2] - origin[2]) || 1;
      const graze = 1 - Math.abs(end[hit.axis] - origin[hit.axis]) / len;
      if (Math.random() < (RICOCHET_CHANCE[hit.surface] ?? 0) * graze) play('ricochet', { dist, pan, rate: RICOCHET_RATE[hit.surface] ?? 1, pri: PRI.impact });
    }
    played++;
  }
});

// surface: 'concrete' | 'wood' | 'steel', or { x, y, z } feet to look it up on the map.
const stepName = (surface) => {
  const s = surfaceOf(typeof surface === 'string' ? surface : surface ? surfaceUnder(surface, surfaces) : DEFAULT_SURFACE);
  return `step.${FOOTSTEPS[s] ? s : DEFAULT_SURFACE}`;
};
export const footstep = safe((dist = 0, pan = 0, surface = DEFAULT_SURFACE) => {
  play(stepName(surface), { dist, pan, pri: PRI.step });
});

// Your own landing at vertical speed vy (m/s, either sign).
export const landing = safe((vy, surface = DEFAULT_SURFACE) => {
  const g = Math.min(1, Math.abs(finite(vy)) / LAND.fullVy);
  if (!(g > 0)) return;
  play('land', { gain: g, pri: PRI.self });
  play(stepName(surface), { gain: LAND.step * g, rate: LAND.stepRate, pri: PRI.self });
});

// Call every frame with your own mover: a landing plays after LAND.minAir aloft.
export function ground(grounded, feet) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    if (!grounded) {
      if (airSince < 0) airSince = t;
      fallVy = finite(feet?.vy);
      return;
    }
    if (airSince >= 0 && t - airSince >= LAND.minAir) landing(fallVy, feet);
    airSince = -1;
  } catch (e) { fail(e); }
}

// An own shot's case hits the ground a moment later.
export const casing = safe(() => play('casing', { delay: CASING_DELAY, pri: PRI.step }));

// The map, for impact and footstep surfaces, and its id, for the engine
// wave's pads. Works before start().
export function setWorld(map, id = null) {
  mapId = id;
  biblePads = (map.pads ?? []).map((p) => p.pos);
  try { surfaces = surfacesOf(map); } catch (e) { fail(e); }
}

// --- Your own feedback: instant, dry and loud. ---
// kind: 'body' | 'head' | 'shield' (a hit the target's Shield took).
export const hit = safe((kind = 'body') => play(kind === 'head' ? 'confirm.head' : kind === 'shield' ? 'confirm.shield' : 'confirm.hit', { pri: PRI.self }));
export const hitTick = (head = false) => hit(head ? 'head' : 'body');

// Kills close together climb in pitch.
export const kill = safe(() => {
  const t = ctx.currentTime;
  streak = t - lastKill < KILL_STREAK.window ? Math.min(streak + 1, KILL_STREAK.max) : 0;
  lastKill = t;
  play('confirm.kill', { rate: semis(streak * KILL_STREAK.semitones), pri: PRI.self });
  duck(DUCK.kill);
});

// absorbed: your Shield took all of it, so a low ping instead of the thud.
export const hurt = safe((absorbed = false) => {
  if (absorbed) return play('confirm.shield', { gain: 0.5, rate: 0.7, pri: PRI.self });
  play('confirm.hurt', { pri: PRI.self });
  duck(DUCK.hurt);
});

export const deathThud = safe(() => {
  play('confirm.death', { pri: PRI.self });
  muffleTo(MUFFLE.dead);
  streak = 0;
  lastKill = -Infinity;
});

export const respawn = safe(() => {
  play('confirm.respawn', { pri: PRI.self });
  muffleTo(MUFFLE.open);
  airSince = -1; // a jump cut short by death is no landing
  predicted = 0;
});

// name: a UI_SOUNDS key ('click', 'start', 'win', 'lose', 'error').
export const ui = safe((name) => play(`ui.${name}`, { pri: PRI.self }));

// --- Power-ups. Omit dist and pan for your own. ---
// phase: 'pick' | 'use' | 'boom' | 'arm' | 'fuse' | 'break' | 'fizzle'.
export const power = safe((kind, phase, dist = 0, pan = 0) => {
  const key = phase === 'pick' ? `pick.${kind}` : phase === 'fizzle' ? 'fizzle' : `${kind}.${phase}`;
  const name = POWER_SOUNDS[key] ? `power.${key}` : POWER_COLORS[kind] ? null : POWER_FALLBACK[phase];
  if (!name) return;
  const boom = phase === 'boom';
  play(name, { dist, pan, pri: boom ? PRI.gun : dist > 0 ? PRI.world : PRI.self, bus: boom ? loud : sfx });
  if (boom) duck(DUCK.boom * distGain(finite(dist))); // the rest of the world, not the boom: it has its own bus
});

// Threats aimed at you. 'lock': a locked Shunt's beeps per second (0 off;
// beepRate(distance) gives it), called every frame. 'shock': 0 none, else
// you are a Shock's target: its whine plays at your feet, louder.
export const warn = safe((kind, level) => {
  const t = ctx.currentTime;
  if (kind === 'lock') {
    const rate = Math.min(LOCK.fast, Math.max(0, finite(level)));
    if (!rate) nextBeep = 0;
    else if ((nextBeep = Math.max(nextBeep, t)) < t + LOCK.lookahead) {
      play('power.shunt.lock', { delay: nextBeep - t, pri: PRI.self });
      nextBeep += 1 / rate;
    }
  } else if (kind === 'shock') {
    const on = finite(level) > 0;
    if (on && !shockOn) play('power.shock.use', { gain: SHOCK_TARGET, pri: PRI.self });
    shockOn = on;
  }
});

// list: [{ distance, pan, up? }], every pad; the two nearest that are up
// (up !== false) hum, fading out toward HUM_RANGE m. Call it a few times a second.
export const padHums = safe((list) => {
  let first = null;
  for (let k = 0; k < 2; k++) {
    let best = null;
    for (const p of list) {
      if (p === first || p.up === false || !(p.distance <= HUM_RANGE) || (best && p.distance >= best.distance)) continue;
      best = p;
    }
    if (!best) return;
    hold(`hum${k}`, 'power.hum', 1 - best.distance / HUM_RANGE, best.pan);
    first = best;
  }
});

// Per snapshot: the power-up entities, [{ id, kind, x, z, state | armed }];
// heard(x, z) → [dist, pan]. Shunts hiss where they fly and stop the moment
// they are gone; mines click as they arm and beep on their fuse. The engine
// wave's Bolts, which fly as entities, zap as they appear.
export const entities = safe((list, heard) => {
  diffEntities(ents, list, (what, e) => {
    if (what === 'gone') return release(`shunt${e.id}`, HOLD.gone);
    const [dist, pan] = heard(e.x, e.z);
    if (what === 'fly') { if (dist <= SPACE.maxDist) hold(`shunt${e.id}`, 'power.shunt.hiss', distGain(dist), pan); }
    else if (what === 'new') { if (e.kind === 'bolt') gunshot('bolt', dist, pan); }
    else power('mine', what, dist, pan);
  });
});

// The pads as padHums wants them, from either wire: the bible's pd rows
// ([k, readyTick, span], up at readyTick 0) at the map's pads, or the engine
// wave's pads (0 when up) at its padsFor(map).
let biblePads = []; // setWorld()
function padsHeard(pu, heard) {
  const at = pu.pd ? biblePads : sharedPowers.padsFor?.(mapId) ?? [];
  const state = pu.pd ?? pu.pads ?? [];
  const n = Math.min(at.length, state.length);
  for (let i = 0; i < n; i++) {
    const h = (hums[i] ??= {});
    [h.distance, h.pan] = heard(at[i][0], at[i][2]);
    h.up = pu.pd ? state[i][1] === 0 : !state[i];
  }
  hums.length = n;
}

// Once per snapshot, from main.js, for either power-up wire. me is net.js's
// self; heard(x, z) → [dist, pan]. Shunts hiss, mines click, a Shunt locked
// on you beeps, a Shock aimed at you whines, the nearest pads hum, and your
// Shield breaking pops.
export const snapshot = safe((m, me, myId, heard) => {
  const alive = !!(me.alive && me.mover);
  if (m.pu) {
    const list = readEntities(m.pu, rows);
    entities(list, heard);
    warn('lock', alive ? lockRate(list, me.mover, myId) : 0);
    let shock = false;
    for (const e of list) if (e.kind === 'dome' && e.target === myId) shock = true;
    warn('shock', alive && shock ? 1 : 0);
    if (++humTick % HUM_EVERY === 0) {
      if (alive) padsHeard(m.pu, heard);
      else hums.length = 0;
      padHums(hums);
    }
  }
  const shield = me.pw?.shield ?? me.shield ?? 0;
  if (shieldWas > 0 && !(shield > 0) && me.alive) power('shield', 'break');
  shieldWas = shield;
});

// The engine wave's power-up events (pickup, powerup, blast), from main.js.
// The bible's pick, use and boom are client/powerups.js's to play (it holds
// them to the render tick, §8.9 row 8), so they are ignored here: playing
// them too would double every one. Your own use echo is skipped when it was
// already played on prediction.
const ENGINE_PHASE = { pickup: 'pick', powerup: 'use', blast: 'boom' };
export const event = safe((m, myId, heard) => {
  const phase = ENGINE_PHASE[m.e];
  if (!phase) return;
  const own = m.id !== undefined && m.id === myId;
  if (phase === 'use' && own && predicted > 0) {
    predicted--;
    return;
  }
  const pad = phase === 'pick' && sharedPowers.padsFor?.(mapId)?.[m.pad];
  const [dist, pan] = own && phase !== 'boom' ? [0, 0] : pad ? heard(pad[0], pad[2]) : m.x !== undefined ? heard(m.x, m.z) : [0, 0];
  if (phase === 'boom' && m.k === 'bolt') return play(BOLT_HIT, { dist, pan, pri: PRI.impact });
  power(m.k, phase, dist, pan);
});

// Call from fixedStep before predict() with self.inv and the input's keys:
// on the engine wave's wire, your use plays at once. A no-op on the bible's.
export const ownUse = safe((inv, keys) => {
  const kind = usedSlot(inv, keys);
  if (!kind) return;
  predicted++;
  power(kind, 'use');
});

// The wind bed, faded in or out.
export const ambience = safe((on) => {
  ready.then(() => {
    if (on && !wind && banks.wind) {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = banks.wind.bufs[0];
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(banks.wind.gains[0], t, WIND.fade);
      const sway = ctx.createGain(); // the LFO's depth
      sway.gain.value = banks.wind.gains[0] * WIND.sway;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = WIND.lfo;
      lfo.connect(sway).connect(g.gain);
      src.connect(g).connect(sfx);
      src.start(t);
      lfo.start(t);
      wind = { src, lfo, g, sway };
    } else if (!on && wind) {
      const t = ctx.currentTime;
      wind.g.gain.cancelScheduledValues(t);
      wind.g.gain.setTargetAtTime(0, t, WIND.fade / 3);
      wind.sway.gain.setTargetAtTime(0, t, WIND.fade / 3);
      wind.src.stop(t + WIND.fade * 2);
      wind.lfo.stop(t + WIND.fade * 2);
      wind = null;
    }
  }).catch(fail);
});

// 0..1, on top of MIX.master. Works before start().
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, finite(v)));
  if (out) out.gain.value = MIX.master * volume;
}

// For the debug overlay and tests: voices counts one-shots and loops; banks
// counts the sounds rendered so far.
export const stats = () => ({
  state: ctx?.state ?? 'off', voices: active.length + loops.size, loops: loops.size,
  banks: `${Object.keys(banks).length}/${Object.keys(SOUNDS).length}`, renderMs: Math.round(renderMs),
});

/* ---------------------------------------------------------------------------
 * ?debug&sfx: the whole board, BOARD_STEP s per sound. Each entry is
 * [label, seconds, fn(k)], fn called every BOARD_TICK s with k = 0, 1, …
 * ------------------------------------------------------------------------ */
export const BOARD_TICK = 0.05;
const BOARD_STEP = 0.6;
const once = (fn) => (k) => k === 0 && fn();
const near = [6, 0.7];
const far = [35, -0.6];
export const BOARD = [
  ...['rifle', 'pistol', 'shotgun', 'bolt'].map((w) => [w, BOARD_STEP, once(() => gunshot(w))]),
  ['rifle 6 m right', BOARD_STEP, once(() => gunshot('rifle', ...near))],
  ['shotgun 35 m left', BOARD_STEP, once(() => gunshot('shotgun', ...far))],
  ...Object.keys(IMPACTS).map((s) => [`impact ${s}`, BOARD_STEP, once(() => play(`impact.${s}`, { dist: 4 }))]),
  ['ricochet', BOARD_STEP, once(() => play('ricochet', { dist: 4, pan: 0.5 }))],
  ...Object.keys(FOOTSTEPS).map((s) => [`steps ${s}`, BOARD_STEP, (k) => k % 4 === 0 && footstep(0, 0, s)]),
  ['landing', BOARD_STEP, once(() => landing(6.3))],
  ['casing', BOARD_STEP, once(() => casing('rifle'))],
  ...['body', 'head', 'shield'].map((h) => [`hit ${h}`, BOARD_STEP, once(() => hit(h))]),
  ['kill', BOARD_STEP, once(() => kill())],
  ['hurt', BOARD_STEP, once(() => hurt())],
  ['death', BOARD_STEP * 2, once(() => deathThud())],
  ['respawn', BOARD_STEP, once(() => respawn())],
  ...Object.keys(UI_SOUNDS).map((n) => [`ui ${n}`, BOARD_STEP, once(() => ui(n))]),
  ...Object.keys(PICK_ROOTS).map((k) => [`pick ${k}`, BOARD_STEP, once(() => power(k, 'pick'))]),
  ...['shunt', 'barge', 'mine', 'nitro', 'shield'].map((k) => [`use ${k}`, BOARD_STEP, once(() => power(k, 'use'))]),
  ['use shock (others)', BOARD_STEP * 2, once(() => power('shock', 'use', ...near))],
  ['shock target', BOARD_STEP * 2, (k) => warn('shock', k < 20 ? 1 : 0)],
  ['shock strikes', BOARD_STEP * 2, (k) => k % 8 === 0 && power('shock', 'boom', 5, 0.3)],
  ['shunt flies by', BOARD_STEP * 3, (k) => hold('board', 'power.shunt.hiss', distGain(Math.abs(18 - k)), (k - 18) / 18)],
  ['shunt lock closing', BOARD_STEP * 4, (k) => warn('lock', k < 46 ? beepRate(40 - k) : 0)],
  ['shunt boom', BOARD_STEP * 2, once(() => power('shunt', 'boom', 8, -0.3))],
  ['mine arm', BOARD_STEP, once(() => power('mine', 'arm', 2))],
  ['mine fuse', BOARD_STEP, once(() => power('mine', 'fuse', 2))],
  ['mine boom', BOARD_STEP * 2, once(() => power('mine', 'boom', 3))],
  ['shield break', BOARD_STEP, once(() => power('shield', 'break'))],
  ['fizzle', BOARD_STEP, once(() => power('shunt', 'fizzle', 6))],
  ['pad hums', BOARD_STEP * 3, (k) => k % 2 === 0 && padHums([{ distance: 1 + k / 10, pan: -0.5 }, { distance: 4, pan: 0.6 }])],
];
export const BOARD_SECONDS = BOARD.reduce((s, b) => s + b[1], 0);

// The board at t s from its start; call every BOARD_TICK s.
export const boardTick = safe((t) => {
  watchLoops();
  for (let i = 0, from = 0; i < BOARD.length; from += BOARD[i][1], i++) {
    if (t < from - 1e-6 || t >= from + BOARD[i][1] - 1e-6) continue;
    const k = Math.round((t - from) / BOARD_TICK);
    if (k === 0) console.info(`sfx: ${BOARD[i][0]}`);
    BOARD[i][2](k);
  }
});

function playBoard() {
  let k = 0;
  const timer = setInterval(() => {
    if (k * BOARD_TICK >= BOARD_SECONDS) return clearInterval(timer);
    boardTick(k++ * BOARD_TICK);
  }, BOARD_TICK * 1000);
}
