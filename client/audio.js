// Web Audio synthesis: every sound is generated, so there are no asset
// files. A sound is a recipe of layers (filtered noise and gliding sines)
// that start() renders once into a few seeded variants. The DSP is plain
// JavaScript, so the tests run it in Node. Playing a sound is then a short
// graph: buffer → [distance lowpass] → gain → [pan] → bus, plus a send to
// one shared convolution reverb. Browsers keep audio muted until a user
// gesture, so start() runs inside a click.
//
// Audio must never break the game: every export is a no-op until start()
// succeeds, and swallows its own errors.
import { shotRng } from '../shared/rng.js';
import { prepareMap } from '../shared/collision.js';
import { SHOT_RANGE } from '../shared/constants.js';

/* ----------------------------------------------------------------------------
 * Look constants: every level, timing and timbre. Seconds, Hz, linear gain.
 *
 * A recipe is { layers, gain, n, vary, drive, send, loop }:
 *   layers  named layers, summed;
 *   gain    playback level;        n  variants rendered (default 1);
 *   vary    ± jitter of each layer's f, f1, d and g per variant (default VARY);
 *   drive   tanh saturation for density and punch (default 1: none);
 *   send    reverb send multiplier (default 1);
 *   loop    seconds: a seamless sustained loop instead of a one-shot.
 * A layer is { src: 'noise' | 'sine', at, a, d, g, ... }: it starts at `at`,
 * rises over `a`, then decays with time constant `d`, at gain `g`.
 *   noise: mode 'lp' | 'bp' | 'hp', cutoff f, q; f1 + glide sweep the cutoff
 *          toward f1 with that time constant; density < 1 makes sparse crackle.
 *   sine:  pitch f, gliding toward f1 the same way; partials
 *          [[ratio, gain, decay×], ...]; fm [ratio, index] phase modulation.
 *   both:  am [rate, depth] tremolo.
 * ------------------------------------------------------------------------- */

// Gunshots: a transient click, a noise body, a low thump and a tail, plus
// the mechanism (bolt, slide, pump).
export const GUNSHOTS = {
  rifle: { n: 4, gain: 0.75, drive: 2, layers: {
    click: { src: 'noise', mode: 'hp', f: 4000, d: 0.0025, g: 0.9 },
    body: { src: 'noise', mode: 'bp', f: 1700, q: 0.9, a: 0.0006, d: 0.03, g: 1 },
    thump: { src: 'sine', f: 180, f1: 50, glide: 0.025, a: 0.0015, d: 0.06, g: 0.75 },
    tail: { src: 'noise', mode: 'lp', f: 2000, f1: 350, glide: 0.12, a: 0.006, d: 0.16, g: 0.3 },
    bolt: { src: 'noise', mode: 'bp', f: 3200, q: 3, at: 0.05, a: 0.0005, d: 0.006, g: 0.15 },
  } },
  pistol: { n: 4, gain: 0.65, drive: 1.8, layers: {
    click: { src: 'noise', mode: 'hp', f: 5000, d: 0.002, g: 1 },
    body: { src: 'noise', mode: 'bp', f: 2300, q: 1.1, a: 0.0004, d: 0.02, g: 0.9 },
    thump: { src: 'sine', f: 220, f1: 70, glide: 0.02, a: 0.001, d: 0.04, g: 0.6 },
    tail: { src: 'noise', mode: 'lp', f: 2600, f1: 500, glide: 0.08, a: 0.004, d: 0.1, g: 0.22 },
    slide: { src: 'noise', mode: 'bp', f: 3800, q: 3, at: 0.04, a: 0.0005, d: 0.005, g: 0.18 },
  } },
  shotgun: { n: 3, gain: 0.9, drive: 2.5, layers: {
    click: { src: 'noise', mode: 'hp', f: 2500, d: 0.003, g: 0.7 },
    body: { src: 'noise', mode: 'lp', f: 1100, f1: 600, glide: 0.05, a: 0.001, d: 0.07, g: 1 },
    thump: { src: 'sine', f: 125, f1: 36, glide: 0.04, a: 0.002, d: 0.12, g: 1 },
    tail: { src: 'noise', mode: 'lp', f: 1300, f1: 250, glide: 0.2, a: 0.01, d: 0.28, g: 0.35 },
    pumpBack: { src: 'noise', mode: 'bp', f: 1700, q: 2, at: 0.42, a: 0.002, d: 0.022, g: 0.16 },
    pumpFwd: { src: 'noise', mode: 'bp', f: 2600, q: 2.5, at: 0.55, a: 0.001, d: 0.016, g: 0.2 },
  } },
};

// Bullet impacts by surface, and the ricochet whine some of them throw off.
export const IMPACTS = {
  concrete: { n: 3, gain: 0.4, drive: 1.5, layers: {
    crack: { src: 'noise', mode: 'bp', f: 2800, q: 1.2, d: 0.008, g: 1 },
    thud: { src: 'sine', f: 170, f1: 90, glide: 0.02, a: 0.001, d: 0.025, g: 0.5 },
    debris: { src: 'noise', mode: 'bp', f: 4500, q: 1.5, density: 0.04, at: 0.01, a: 0.01, d: 0.07, g: 0.9 },
  } },
  metal: { n: 3, gain: 0.35, layers: {
    hit: { src: 'noise', mode: 'hp', f: 3000, d: 0.003, g: 0.8 },
    ring: { src: 'sine', f: 1100, d: 0.12, g: 0.6, partials: [[1, 1, 1], [2.756, 0.6, 0.6], [5.404, 0.4, 0.35], [8.933, 0.25, 0.2]] },
  } },
  wood: { n: 3, gain: 0.45, layers: {
    knock: { src: 'noise', mode: 'bp', f: 900, q: 1.4, d: 0.012, g: 1 },
    body: { src: 'sine', f: 320, f1: 260, glide: 0.03, a: 0.0008, d: 0.03, g: 0.7, partials: [[1, 1, 1], [2.3, 0.4, 0.6]] },
    splinter: { src: 'noise', mode: 'bp', f: 3000, q: 2, density: 0.03, at: 0.005, a: 0.002, d: 0.05, g: 0.7 },
  } },
  dirt: { n: 3, gain: 0.4, layers: {
    puff: { src: 'noise', mode: 'lp', f: 1200, f1: 400, glide: 0.04, a: 0.002, d: 0.05, g: 1 },
    grit: { src: 'noise', mode: 'bp', f: 3500, q: 1, density: 0.06, a: 0.003, d: 0.07, g: 0.6 },
  } },
  flesh: { n: 3, gain: 0.4, layers: {
    slap: { src: 'noise', mode: 'lp', f: 1500, d: 0.015, g: 1 },
    thump: { src: 'sine', f: 110, f1: 60, glide: 0.03, a: 0.001, d: 0.05, g: 0.8 },
  } },
};
export const RICOCHET = { n: 3, gain: 0.3, vary: 0.15, layers: {
  whine: { src: 'sine', f: 2800, f1: 1100, glide: 0.2, a: 0.01, d: 0.12, g: 1, fm: [0.5, 0.3] },
  hiss: { src: 'noise', mode: 'bp', f: 4000, f1: 1800, glide: 0.2, q: 4, a: 0.005, d: 0.08, g: 0.3 },
} };
// Chance a hit throws a ricochet, times how grazing it is (0 head-on, 1 parallel).
export const RICOCHET_CHANCE = { metal: 0.6, concrete: 0.3 };
export const IMPACTS_PER_SHOT = 3; // a shotgun's 12 pellets play at most this many
export const IMPACT_SCATTER = 0.015; // the extra impacts land up to this much later

// Map surfaces: a box's own `surface` wins, else its colour index maps here.
export const SURFACE_BY_COLOR = ['concrete', 'concrete', 'metal', 'wood', 'concrete', 'metal'];
export const DEFAULT_SURFACE = 'concrete';

// Footsteps by surface: a heel strike, a scuff and some grit.
export const FOOTSTEPS = {
  concrete: { n: 5, gain: 0.3, vary: 0.12, layers: {
    heel: { src: 'sine', f: 120, f1: 70, glide: 0.015, a: 0.001, d: 0.015, g: 0.6 },
    scuff: { src: 'noise', mode: 'bp', f: 1500, q: 0.8, a: 0.002, d: 0.02, g: 0.7 },
    grit: { src: 'noise', mode: 'hp', f: 4000, density: 0.08, at: 0.008, a: 0.002, d: 0.025, g: 0.3 },
  } },
  metal: { n: 5, gain: 0.3, vary: 0.12, layers: {
    heel: { src: 'sine', f: 130, f1: 80, glide: 0.015, a: 0.001, d: 0.015, g: 0.6 },
    clank: { src: 'sine', f: 450, d: 0.04, g: 0.3, partials: [[1, 1, 1], [2.756, 0.5, 0.6], [5.404, 0.3, 0.4]] },
    scuff: { src: 'noise', mode: 'bp', f: 3000, q: 1, a: 0.001, d: 0.015, g: 0.5 },
  } },
  wood: { n: 5, gain: 0.3, vary: 0.12, layers: {
    heel: { src: 'sine', f: 160, f1: 110, glide: 0.015, a: 0.001, d: 0.02, g: 0.6 },
    hollow: { src: 'sine', f: 240, d: 0.03, g: 0.4, partials: [[1, 1, 1], [2.3, 0.4, 0.6]] },
    scuff: { src: 'noise', mode: 'bp', f: 1100, q: 1, a: 0.002, d: 0.02, g: 0.6 },
  } },
  dirt: { n: 5, gain: 0.3, vary: 0.12, layers: {
    heel: { src: 'sine', f: 90, f1: 60, glide: 0.015, a: 0.001, d: 0.015, g: 0.4 },
    crunch: { src: 'noise', mode: 'lp', f: 1800, f1: 600, glide: 0.02, a: 0.002, d: 0.03, g: 0.8 },
    grit: { src: 'noise', mode: 'bp', f: 3000, q: 1, density: 0.1, a: 0.004, d: 0.05, g: 0.5 },
  } },
};
// A landing after this long in the air: the footstep, louder and lower.
export const LAND = { minAir: 0.2, gain: 1.4, rate: 0.82 };

// Your own confirmations: instant, dry, never jittered, so they read at once.
const BELL = [[1, 1, 1], [2.756, 0.45, 0.55], [5.404, 0.25, 0.3]];
const CHIME = [[1, 1, 1], [2, 0.25, 0.6], [3, 0.12, 0.4]];
export const CONFIRMS = {
  hit: { gain: 0.7, layers: {
    tick: { src: 'sine', f: 1600, f1: 1400, glide: 0.02, a: 0.0005, d: 0.022, g: 1, partials: [[1, 1, 1], [2, 0.3, 0.5]] },
    click: { src: 'noise', mode: 'hp', f: 6000, d: 0.0015, g: 0.6 },
    thud: { src: 'sine', f: 150, f1: 90, glide: 0.02, a: 0.001, d: 0.025, g: 0.5 },
  } },
  head: { gain: 0.75, layers: {
    ding: { src: 'sine', f: 2200, a: 0.0005, d: 0.07, g: 1, partials: BELL },
    click: { src: 'noise', mode: 'hp', f: 7000, d: 0.002, g: 0.6 },
    tick: { src: 'sine', f: 1600, f1: 1400, glide: 0.02, a: 0.0005, d: 0.022, g: 0.5 },
  } },
  kill: { gain: 0.8, layers: {
    punch: { src: 'sine', f: 160, f1: 50, glide: 0.05, a: 0.001, d: 0.08, g: 1 },
    crack: { src: 'noise', mode: 'hp', f: 3000, d: 0.004, g: 0.6 },
    low: { src: 'sine', f: 1046.5, a: 0.002, d: 0.09, g: 0.5, partials: CHIME },
    high: { src: 'sine', f: 1568, at: 0.05, a: 0.002, d: 0.16, g: 0.55, partials: CHIME },
    shimmer: { src: 'noise', mode: 'hp', f: 7000, at: 0.05, a: 0.005, d: 0.05, g: 0.12 },
  } },
  killHead: { gain: 0.85, layers: {
    punch: { src: 'sine', f: 160, f1: 50, glide: 0.05, a: 0.001, d: 0.08, g: 1 },
    ding: { src: 'sine', f: 2200, a: 0.0005, d: 0.07, g: 0.6, partials: BELL },
    low: { src: 'sine', f: 1046.5, a: 0.002, d: 0.09, g: 0.5, partials: CHIME },
    high: { src: 'sine', f: 2093, at: 0.05, a: 0.002, d: 0.18, g: 0.55, partials: CHIME },
    shimmer: { src: 'noise', mode: 'hp', f: 8000, at: 0.05, a: 0.005, d: 0.07, g: 0.15 },
  } },
  hurt: { gain: 0.6, layers: {
    thud: { src: 'sine', f: 95, f1: 45, glide: 0.04, a: 0.001, d: 0.07, g: 1 },
    smack: { src: 'noise', mode: 'lp', f: 700, d: 0.025, g: 0.6 },
  } },
  death: { gain: 0.7, layers: {
    boom: { src: 'sine', f: 120, f1: 32, glide: 0.15, a: 0.002, d: 0.35, g: 1 },
    rumble: { src: 'noise', mode: 'lp', f: 500, f1: 120, glide: 0.3, a: 0.01, d: 0.4, g: 0.5 },
  } },
  respawn: { gain: 0.35, layers: {
    rise: { src: 'noise', mode: 'bp', f: 300, f1: 2500, glide: 0.15, q: 1.2, a: 0.08, d: 0.12, g: 0.6 },
    tone: { src: 'sine', f: 440, f1: 880, glide: 0.1, a: 0.05, d: 0.12, g: 0.3 },
  } },
};
export const KILL_STREAK = { window: 6, semitones: 2, max: 4 }; // kills this close climb in pitch

// Menu and match sounds.
const TRI = [[1, 1, 1], [3, 0.11, 0.7], [5, 0.04, 0.5]]; // a soft, triangle-like tone
export const UI_SOUNDS = {
  click: { gain: 0.2, layers: {
    blip: { src: 'sine', f: 1800, f1: 1500, glide: 0.008, a: 0.0003, d: 0.008, g: 1 },
    tick: { src: 'noise', mode: 'hp', f: 5000, d: 0.001, g: 0.4 },
  } },
  start: { gain: 0.4, layers: {
    c: { src: 'sine', f: 523.25, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    e: { src: 'sine', f: 659.25, at: 0.09, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    g: { src: 'sine', f: 783.99, at: 0.18, a: 0.004, d: 0.3, g: 1, partials: TRI },
  } },
  win: { gain: 0.45, layers: {
    c: { src: 'sine', f: 523.25, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    e: { src: 'sine', f: 659.25, at: 0.1, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    g: { src: 'sine', f: 783.99, at: 0.2, a: 0.004, d: 0.12, g: 0.8, partials: TRI },
    c2: { src: 'sine', f: 1046.5, at: 0.3, a: 0.004, d: 0.35, g: 1, partials: TRI },
  } },
  lose: { gain: 0.4, layers: {
    g: { src: 'sine', f: 392, a: 0.004, d: 0.2, g: 0.9, partials: TRI },
    eb: { src: 'sine', f: 311.13, at: 0.18, a: 0.004, d: 0.35, g: 1, partials: TRI },
  } },
  error: { gain: 0.3, layers: {
    buzz: { src: 'sine', f: 180, fm: [1, 2.5], a: 0.002, d: 0.04, g: 1 },
    again: { src: 'sine', f: 180, fm: [1, 2.5], at: 0.09, a: 0.002, d: 0.05, g: 1 },
  } },
};

// Generic power-up hooks. Each kind plays the shared sound at its own pitch.
export const POWERUPS = {
  pickup: { gain: 0.45, layers: {
    e: { src: 'sine', f: 1318.5, a: 0.002, d: 0.12, g: 0.8, partials: [[1, 1, 1], [2.01, 0.3, 0.6], [3.98, 0.12, 0.3]] },
    b: { src: 'sine', f: 1975.5, at: 0.05, a: 0.002, d: 0.12, g: 0.8, partials: [[1, 1, 1], [2.01, 0.3, 0.6]] },
    e2: { src: 'sine', f: 2637, at: 0.1, a: 0.002, d: 0.25, g: 0.9, partials: [[1, 1, 1], [2.01, 0.3, 0.6]] },
    shimmer: { src: 'noise', mode: 'hp', f: 8000, a: 0.01, d: 0.08, g: 0.15 },
  } },
  use: { n: 2, gain: 0.45, layers: {
    whoosh: { src: 'noise', mode: 'bp', f: 250, f1: 3000, glide: 0.15, q: 1.2, a: 0.08, d: 0.1, g: 1 },
    air: { src: 'noise', mode: 'lp', f: 500, a: 0.05, d: 0.12, g: 0.3 },
  } },
  explosion: { n: 2, gain: 1, drive: 2.5, send: 1.6, layers: {
    crack: { src: 'noise', mode: 'hp', f: 2000, d: 0.006, g: 0.8 },
    boom: { src: 'sine', f: 80, f1: 28, glide: 0.12, a: 0.003, d: 0.3, g: 1 },
    body: { src: 'noise', mode: 'lp', f: 1500, f1: 120, glide: 0.3, a: 0.005, d: 0.35, g: 0.9 },
    debris: { src: 'noise', mode: 'bp', f: 2500, q: 1, density: 0.02, at: 0.12, a: 0.05, d: 0.3, g: 0.5 },
  } },
  shield: { n: 2, gain: 0.45, layers: {
    zap: { src: 'sine', f: 1200, f1: 600, glide: 0.08, fm: [1.5, 2.5], a: 0.001, d: 0.1, g: 0.8 },
    shimmer: { src: 'noise', mode: 'bp', f: 6000, q: 3, a: 0.001, d: 0.06, g: 0.4 },
    hum: { src: 'sine', f: 220, a: 0.005, d: 0.15, g: 0.4, partials: [[1, 1, 1], [2, 0.5, 1]] },
  } },
  boost: { loop: 1, gain: 0.25, layers: {
    hum: { src: 'sine', f: 55, g: 0.6, am: [6, 0.35], partials: [[1, 1, 1], [2, 0.6, 1], [3, 0.35, 1], [4, 0.2, 1]] },
    wind: { src: 'noise', mode: 'bp', f: 900, q: 0.8, g: 0.5, am: [6, 0.2] },
  } },
};
export const POWERUP_SEMITONES = { shunt: 0, bolt: 5, barge: -5, shock: 7, mine: -3, nitro: 3, shield: 10, repair: 12 }; // others hash to -6..6
export const BOOST = { fade: 0.06, timeout: 0.2 }; // a loop not refreshed this long fades out

// Mix: buses, reverb, distance, ducking.
export const MIX = { master: 0.7, sfx: 1, confirm: 0.9, reverb: 0.6 };
export const COMPRESSOR = { threshold: -14, knee: 10, ratio: 6, attack: 0.003, release: 0.15 }; // glues the world bus
export const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.1 }; // the last stage: a pile-up never clips
export const REVERB = { seconds: 1.5, rt60: 1.2, predelay: 0.01, early: 10, earlySpread: 0.06, earlyGain: 0.4, bright: 8000, dark: 900 };
// Others are quieter (half the level at halfGainDist), darker and relatively
// wetter with distance, and culled past maxDist.
export const SPACE = { halfGainDist: 10, cutoffNear: 18000, cutoffHalfDist: 18, cutoffFar: 1200, panWidth: 0.8, wet: 0.25, maxDist: 90 };
export const DUCK = { kill: 0.35, hurt: 0.25, explosion: 0.5, attack: 0.005, hold: 0.06, release: 0.15 }; // dips the world under big moments
export const MUFFLE = { open: 20000, dead: 650, time: 0.2 }; // the world goes dull while you are dead
export const JITTER = { rate: 0.035, gain: 0.12 }; // ± per play, on top of the variants
export const VOICE_LIMIT = 32; // one-shots at once; the lowest priority is stolen
export const VARY = 0.06;
export const PEAK = 0.9; // every rendered one-shot peaks here before its gain

/* ---------------------------------------------------------------------------
 * DSP: pure, seeded, and run once at start().
 * ------------------------------------------------------------------------ */
const TAU = 2 * Math.PI;
const SEED = 0x5eed;
const TAIL = Math.log(100); // buffers run until their longest layer is down 40 dB; the reverb carries the rest
const LOOP_XFADE = 0.05;
const FADE_OUT = 0.004;

// Every sound by name ('gun.rifle', 'impact.wood', 'step.metal', …), in the
// order start() renders them: the ones a fight needs first.
const group = (prefix, sounds) => Object.fromEntries(Object.entries(sounds).map(([k, v]) => [`${prefix}.${k}`, v]));
export const SOUNDS = {
  ...group('confirm', CONFIRMS), ...group('gun', GUNSHOTS), ...group('impact', IMPACTS), ...group('step', FOOTSTEPS),
  ricochet: RICOCHET, ...group('ui', UI_SOUNDS), ...group('power', POWERUPS),
};

// FNV-1a: a stable number per name, so adding a sound reshuffles no other.
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const tremolo = (am, t) => (am ? 1 - am[1] * (0.5 + 0.5 * Math.sin(TAU * am[0] * t)) : 1);

// The shared inner loop: a linear attack, then an exponential decay (or held
// at 1 for loops), and a frequency gliding exponentially from f toward f1.
// Both run as per-sample multiplies; each layer stops once below -60 dB.
// sample(f, t) returns the raw source at frequency f and time t; the
// envelope and gain are applied here.
function addLayer(out, l, fs, held, gain, decay, sample) {
  const start = Math.round(l.at * fs);
  const attack = Math.max(1, Math.round(l.a * fs));
  const fall = Math.exp(-1 / (decay * fs));
  const sweep = l.f1 === undefined ? 1 : Math.exp(-1 / (l.glide * fs));
  const target = l.f1 ?? l.f;
  let dev = l.f - target;
  let e = 0;
  for (let i = start, j = 0; i < out.length; i++, j++) {
    if (held) e = 1;
    else if (j < attack) e = j / attack;
    else if ((e = j === attack ? 1 : e * fall) < 1e-3) break;
    out[i] += sample(target + dev, j / fs) * e * gain;
    dev *= sweep;
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
function addSine(out, l, fs, held) {
  for (const [ratio, pg, pd] of l.partials ?? [[1, 1, 1]]) {
    if (l.f * ratio >= fs * 0.45) continue;
    let ph = 0;
    let mph = 0;
    addLayer(out, l, fs, held, l.g * pg, l.d * pd, (f, t) => {
      const x = Math.sin(ph + (l.fm ? l.fm[1] * Math.sin(mph) : 0));
      if ((ph += (TAU * f * ratio) / fs) > TAU) ph -= TAU;
      if (l.fm && (mph += (TAU * f * ratio * l.fm[0]) / fs) > TAU) mph -= TAU;
      return x * tremolo(l.am, t);
    });
  }
}

// One variant of a recipe as mono samples at fs; rand jitters the layers.
export function renderSound(recipe, fs, rand) {
  const vary = recipe.vary ?? VARY;
  const jit = (v) => v * (1 + (rand() * 2 - 1) * vary);
  const layers = Object.values(recipe.layers).map((l) => ({
    ...l, at: l.at ?? 0, a: Math.max(l.a ?? 0, 2 / fs), d: jit(l.d ?? 1), g: jit(l.g),
    f: jit(l.f), f1: l.f1 === undefined ? undefined : jit(l.f1),
  }));
  const held = !!recipe.loop;
  const seconds = held ? recipe.loop + LOOP_XFADE
    : Math.max(...layers.map((l) => l.at + l.a + l.d * TAIL * Math.max(...(l.partials ?? [[1, 1, 1]]).map((p) => p[2]))));
  let out = new Float32Array(Math.ceil(seconds * fs));
  for (const l of layers) {
    if (l.src === 'noise') addNoise(out, l, fs, rand, held);
    else addSine(out, l, fs, held);
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

/* ---------------------------------------------------------------------------
 * Space and surfaces: pure.
 * ------------------------------------------------------------------------ */
// Distance in metres → level, lowpass cutoff and reverb send of a voice.
export const distGain = (d) => 1 / (1 + d / SPACE.halfGainDist);
export const distCutoff = (d) => Math.max(SPACE.cutoffFar, SPACE.cutoffNear / (1 + d / SPACE.cutoffHalfDist));
export const wetSend = (d) => SPACE.wet * Math.sqrt(distGain(d)); // falls slower than the dry level

// Map JSON → boxes ({ min, max, surface }), in map order.
export function surfacesOf(map) {
  return prepareMap(map).boxes.map((b, i) => ({ ...b, surface: map.boxes[i].surface ?? SURFACE_BY_COLOR[map.boxes[i].color] ?? DEFAULT_SURFACE }));
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

/* ---------------------------------------------------------------------------
 * Runtime.
 * ------------------------------------------------------------------------ */
let ctx = null; // set last in init(), so every export stays a no-op until audio fully works
let out; // master gain → limiter → speakers
let sfx; // the world: ducked, muffled while dead, compressed
let confirm; // your own feedback and UI: dry and never ducked
let send; // → the convolution reverb
let muffle;
let banks = {}; // name → { bufs, last, gain, send, exact }
const active = []; // playing one-shots: { src, g, pri }
const loops = new Map(); // boost loops by id
let surfaces = [];
let volume = 1;
let renderMs = 0;
let warned = false;
let streak = 0;
let lastKill = -Infinity;
let airSince = -1;

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

function init() {
  const c = new AudioContext({ latencyHint: 'interactive' });
  const t0 = performance.now();
  const fs = c.sampleRate;
  const dynamics = (settings) => {
    const d = c.createDynamicsCompressor();
    for (const [k, v] of Object.entries(settings)) d[k].value = v;
    return d;
  };
  out = c.createGain();
  out.gain.value = MIX.master * volume;
  out.connect(dynamics(LIMITER)).connect(c.destination);
  const comp = dynamics(COMPRESSOR);
  muffle = c.createBiquadFilter();
  muffle.frequency.value = MUFFLE.open;
  sfx = c.createGain();
  sfx.gain.value = MIX.sfx;
  sfx.connect(muffle).connect(comp).connect(out);
  confirm = c.createGain();
  confirm.gain.value = MIX.confirm;
  confirm.connect(out);
  const verb = c.createConvolver();
  verb.buffer = toBuffer(c, renderIR(fs, REVERB, shotRng(SEED, hash('reverb'), 0)));
  const ret = c.createGain();
  ret.gain.value = MIX.reverb;
  send = c.createGain();
  send.connect(verb).connect(ret).connect(muffle);
  renderMs = performance.now() - t0;
  renderBanks(c);
  setInterval(safe(watchLoops), 100);
  document.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('button')) ui('click'); });
  ctx = c;
}

// Rendering every variant takes a few hundred ms of CPU, so it runs one
// variant per task: no long frame. A sound plays once its bank is in.
async function renderBanks(c) {
  try {
    for (const [name, r] of Object.entries(SOUNDS)) {
      const bufs = [];
      for (let v = 0; v < (r.n ?? 1); v++) {
        await new Promise((resolve) => setTimeout(resolve));
        const t0 = performance.now();
        bufs.push(toBuffer(c, [renderSound(r, c.sampleRate, shotRng(SEED, hash(name), v))]));
        renderMs += performance.now() - t0;
      }
      banks[name] = { bufs, last: -1, gain: r.gain, send: r.send ?? 1, exact: /^(confirm|ui)\./.test(name) };
    }
  } catch (e) { fail(e); }
}

export function start() {
  try {
    if (!ctx) init();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch (e) {
    ctx = null;
    fail(e);
  }
}

// Room for one more voice: steal the lowest-priority, oldest one if full.
function admit(pri) {
  if (active.length < VOICE_LIMIT) return true;
  let k = -1;
  for (let i = 0; i < active.length; i++) if (active[i].pri < pri && (k < 0 || active[i].pri < active[k].pri)) k = i;
  if (k < 0) return false;
  const [v] = active.splice(k, 1);
  const t = ctx.currentTime;
  v.g.gain.setTargetAtTime(0, t, 0.004);
  v.src.stop(t + 0.03);
  return true;
}

// One voice. dist 0 is your own sound: centred, full level, no distance filter.
function play(name, { dist = 0, pan = 0, gain = 1, rate = 1, delay = 0, pri = PRI.world } = {}) {
  const bank = banks[name];
  dist = finite(dist);
  if (!bank || dist > SPACE.maxDist || !admit(pri)) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  bank.last = pickVariant(bank.bufs.length, bank.last);
  src.buffer = bank.bufs[bank.last];
  src.playbackRate.value = finite(rate * (bank.exact ? 1 : jitter(JITTER.rate))) || 1;
  const level = bank.gain * gain * (bank.exact ? 1 : jitter(JITTER.gain));
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
  tail.connect(bank.exact ? confirm : sfx);
  if (!bank.exact) {
    const w = ctx.createGain();
    w.gain.value = finite(level * wetSend(dist) * bank.send);
    head.connect(w).connect(send);
  }
  const v = { src, g, pri };
  active.push(v);
  src.onended = () => {
    const i = active.indexOf(v);
    if (i >= 0) active.splice(i, 1);
  };
  src.start(t);
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
export const gunshot = safe((weapon, dist = 0, pan = 0) => {
  play(`gun.${GUNSHOTS[weapon] ? weapon : 'rifle'}`, { dist, pan, pri: dist > 0 ? PRI.gun : PRI.self });
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
      if (Math.random() < (RICOCHET_CHANCE[hit.surface] ?? 0) * graze) play('ricochet', { dist, pan, pri: PRI.impact });
    }
    played++;
  }
});

// feet: { x, y, z } of the stepping player, for the surface underfoot.
export const footstep = safe((dist = 0, pan = 0, feet = null) => {
  const surface = feet ? surfaceUnder(feet, surfaces) : DEFAULT_SURFACE;
  play(`step.${FOOTSTEPS[surface] ? surface : DEFAULT_SURFACE}`, { dist, pan, pri: PRI.step });
});

// Call every frame with your own mover: a landing plays after LAND.minAir aloft.
export function ground(grounded, feet) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    if (!grounded) {
      if (airSince < 0) airSince = t;
      return;
    }
    if (airSince >= 0 && t - airSince >= LAND.minAir) {
      const surface = surfaceUnder(feet, surfaces);
      play(`step.${FOOTSTEPS[surface] ? surface : DEFAULT_SURFACE}`, { gain: LAND.gain, rate: LAND.rate, pri: PRI.self });
    }
    airSince = -1;
  } catch (e) { fail(e); }
}

// The map, for impact and footstep surfaces. Works before start().
export function setWorld(map) {
  try { surfaces = surfacesOf(map); } catch (e) { fail(e); }
}

// --- Your own feedback: instant, dry and loud. ---
export const hitTick = safe((head = false) => play(head ? 'confirm.head' : 'confirm.hit', { pri: PRI.self }));

// Kills close together climb in pitch.
export const kill = safe((head = false) => {
  const t = ctx.currentTime;
  streak = t - lastKill < KILL_STREAK.window ? Math.min(streak + 1, KILL_STREAK.max) : 0;
  lastKill = t;
  play(head ? 'confirm.killHead' : 'confirm.kill', { rate: 2 ** ((streak * KILL_STREAK.semitones) / 12), pri: PRI.self });
  duck(DUCK.kill);
});

export const hurt = safe(() => {
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
});

// name: a UI_SOUNDS key ('click', 'start', 'win', 'lose', 'error').
export const ui = safe((name) => play(`ui.${name}`, { pri: PRI.self }));

// --- Power-up hooks; kind is any power-up name. Omit dist and pan for your own. ---
const kindRate = (kind) => 2 ** ((POWERUP_SEMITONES[kind] ?? (hash(String(kind)) % 13) - 6) / 12);
export const pickup = safe((kind, dist = 0, pan = 0) => play('power.pickup', { dist, pan, rate: kindRate(kind), pri: PRI.world }));
export const use = safe((kind, dist = 0, pan = 0) => play('power.use', { dist, pan, rate: kindRate(kind), pri: PRI.world }));
export const shieldHit = safe((dist = 0, pan = 0) => play('power.shield', { dist, pan, pri: PRI.world }));
export const explosion = safe((dist = 0, pan = 0) => {
  play('power.explosion', { dist, pan, pri: PRI.gun });
  duck(DUCK.explosion * distGain(finite(dist)));
});

// A boost loop per id (a player): call it every frame while boosting; it
// fades out on its own once the calls stop.
export function boost(id, dist = 0, pan = 0) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    let l = loops.get(id);
    if (!l) {
      if (!banks['power.boost'] || !(finite(dist) <= SPACE.maxDist)) return;
      const src = ctx.createBufferSource();
      src.buffer = banks['power.boost'].bufs[0];
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      src.connect(g).connect(p).connect(sfx);
      src.start(t);
      l = { src, g, p, seen: t, level: -1, pan: 0 };
      loops.set(id, l);
    }
    l.seen = t;
    const level = POWERUPS.boost.gain * distGain(finite(dist));
    if (Math.abs(level - l.level) > 0.01) l.g.gain.setTargetAtTime((l.level = level), t, BOOST.fade);
    const p = dist > 0 ? clampPan(pan) : 0;
    if (Math.abs(p - l.pan) > 0.02) l.p.pan.setTargetAtTime((l.pan = p), t, 0.03);
  } catch (e) { fail(e); }
}

function watchLoops() {
  const t = ctx.currentTime;
  for (const [id, l] of loops) {
    if (t - l.seen < BOOST.timeout) continue;
    l.g.gain.setTargetAtTime(0, t, BOOST.fade);
    l.src.stop(t + BOOST.fade * 8);
    loops.delete(id);
  }
}

// 0..1, on top of MIX.master. Works before start().
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, finite(v)));
  if (out) out.gain.value = MIX.master * volume;
}

// For the debug overlay and tests: banks counts the sounds rendered so far.
export const stats = () => ({
  state: ctx?.state ?? 'off', voices: active.length, loops: loops.size,
  banks: `${Object.keys(banks).length}/${Object.keys(SOUNDS).length}`, renderMs: Math.round(renderMs),
});
