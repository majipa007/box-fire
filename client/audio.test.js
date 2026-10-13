import test from 'node:test';
import assert from 'node:assert/strict';
import { shotRng } from '../shared/rng.js';
import {
  SOUNDS, REVERB, MIX, COMPRESSOR, SLAP, CLIP, WIND, LOCK, PICK_ROOTS, VOICE_LIMIT, CASING_DELAY, TRANSIENT_RANGE, HUM_RANGE, LAND,
  renderSound, renderIR, shortTerm, dbToGain, distGain, distCutoff, wetSend, surfacesOf, classify, surfaceUnder, pickVariant, clipCurve,
  voiceToSteal, diffEntities, beepRate, lockRate,
} from './audio.js';

const FS = 48000;
const ms = (t) => Math.round((t * FS) / 1000);
const peakOf = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (a, from = 0, to = a.length) => Math.sqrt(a.subarray(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
// Brightness: the RMS of the first difference over the RMS, which grows with
// frequency (2·sin(πf/fs) for a sine), weighted by energy.
const brightness = (a, to) => {
  let d = 0;
  for (let i = 1; i < to; i++) d += (a[i] - a[i - 1]) ** 2;
  return Math.sqrt(d / to) / rms(a, 0, to);
};
const fresh = (name, variant = 0) => renderSound(SOUNDS[name], FS, shotRng(1, 2, variant));
const renders = new Map(); // rendering is slow and pure: once per sound
const render = (name) => renders.get(name) ?? renders.set(name, fresh(name)).get(name);
// One layer of a sound alone, unjittered.
const layer = (name, key, patch = {}) => renderSound({ vary: 0, layers: { x: { ...SOUNDS[name].layers[key], ...patch } } }, FS, shotRng(1, 2, 0));
// Upward zero crossings, interpolated, in seconds.
const ups = (a) => {
  const t = [];
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) t.push((i - 1 + a[i - 1] / (a[i - 1] - a[i])) / FS);
  return t;
};
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol * Math.abs(want), `${what}: ${got} vs ${want}`);

test('every sound renders finite samples under full scale, from and back to silence', () => {
  for (const name of Object.keys(SOUNDS)) {
    const s = render(name);
    assert.ok(s.length > 0 && s.every(Number.isFinite), name);
    assert.ok(peakOf(s) <= 1 && peakOf(s) > 0.5, `${name} peaks at ${peakOf(s)}`);
    if (SOUNDS[name].loop) continue;
    assert.equal(s[0], 0, `${name} starts on a click`);
    assert.ok(Math.abs(s.at(-1)) < 1e-3, `${name} ends on a click`);
  }
});

test('variants are seeded: the same seed repeats, another seed differs', () => {
  assert.deepEqual(fresh('gun.rifle', 0), fresh('gun.rifle', 0));
  assert.notDeepEqual(fresh('gun.rifle', 0), fresh('gun.rifle', 1));
});

test('gunshots hit at once and die away', () => {
  for (const w of ['rifle', 'pistol', 'shotgun', 'bolt']) {
    const s = render(`gun.${w}`);
    const loudest = s.findIndex((v) => Math.abs(v) === peakOf(s));
    assert.ok(loudest < ms(15), `${w} peaks at ${loudest / 48} ms`);
    if (w !== 'bolt') assert.ok(rms(s, s.length - ms(20)) < rms(s, 0, ms(30)) / 50, `${w} tail`); // a Bolt is all crackle to its end
  }
});

test('the shotgun is darker than the rifle, and the rifle darker than the pistol', () => {
  const [pistol, rifle, shotgun] = ['pistol', 'rifle', 'shotgun'].map((w) => brightness(render(`gun.${w}`), ms(60)));
  assert.ok(pistol > rifle && rifle > shotgun, `pistol ${pistol}, rifle ${rifle}, shotgun ${shotgun}`);
});

// The bible's durations (§4.8, §5): [sound, layer (null: the whole sound), seconds].
// A sound lasts until it is down 40 dB, where its buffer ends.
const DURATIONS = [
  ['gun.transient', null, 0.008], ['gun.bolt', null, 0.14],
  ['gun.rifle', 'body', 0.13], ['gun.pistol', 'body', 0.08], ['gun.shotgun', 'body', 0.3],
  ['gun.rifle', 'thump', 0.12], ['gun.pistol', 'thump', 0.12], ['gun.shotgun', 'thump', 0.18],
  ['confirm.hit', null, 0.05], ['confirm.head', null, 0.07], ['confirm.shield', null, 0.06],
  ...Object.keys(PICK_ROOTS).map((k) => [`power.pick.${k}`, 'root', 0.25]),
  ['power.shunt.use', 'rush', 0.4], ['power.shunt.lock', null, 0.03], ['power.barge.use', null, 0.35],
  ['power.shock.use', null, 1.2], ['power.shock.boom', 'crack', 0.08], ['power.shock.boom', 'buzz', 0.3],
  ['power.mine.use', null, 0.06], ['power.mine.arm', null, 0.015], ['power.mine.boom', 'body', 0.5],
  ['power.nitro.use', null, 0.3], ['power.shield.use', null, 0.4], ['power.shield.break', null, 0.2], ['power.fizzle', null, 0.15],
];

test('every duration is within 10% of the bible', () => {
  for (const [name, key, seconds] of DURATIONS) {
    const s = key ? layer(name, key) : renderSound({ ...SOUNDS[name], vary: 0 }, FS, shotRng(1, 2, 0));
    near(s.length / FS, seconds, 0.1, `${name} ${key ?? ''}`);
  }
});

test('sweeps land on their targets', () => {
  // The first and last whole periods against a log sweep from f0 to f1 over seconds, held after.
  const sweep = (name, key, f0, f1, seconds) => {
    const s = layer(name, key, { partials: undefined, am: undefined });
    const t = ups(s).filter((x) => x < s.length / FS - 0.004); // before the fade-out
    const want = (tm) => f0 * (f1 / f0) ** Math.min(1, tm / seconds);
    near(1 / (t[1] - t[0]), want((t[0] + t[1]) / 2), 0.03, `${name} ${key} start`);
    near(1 / (t.at(-1) - t.at(-2)), want((t.at(-1) + t.at(-2)) / 2), 0.03, `${name} ${key} end`);
  };
  sweep('gun.bolt', 'zap', 1900, 350, 0.14);
  sweep('gun.rifle', 'thump', 90, 45, 0.12);
  sweep('gun.shotgun', 'thump', 70, 35, 0.18);
  sweep('power.barge.use', 'whomp', 300, 80, 0.3);
  sweep('power.nitro.use', 'spool', 220, 660, 0.3);
  sweep('power.shock.use', 'whine', 400, 1600, 1.2);
});

test('pickups, kill, fuse and lock beeps play the bible\'s notes', () => {
  const roots = { shunt: 523, bolt: 587, barge: 659, shock: 698, mine: 784, nitro: 880, shield: 988 };
  for (const [k, root] of Object.entries(roots)) {
    const { layers: l } = SOUNDS[`power.pick.${k}`];
    assert.deepEqual([l.root.f, l.third.f / root, l.fifth.f / root].map((v) => +v.toFixed(3)), [root, 1.26, 1.498], k);
    assert.deepEqual([l.root.at ?? 0, l.third.at, l.fifth.at], [0, 0.04, 0.08], k);
    const t = ups(layer(`power.pick.${k}`, 'root', { partials: undefined }));
    near((t.length - 1) / (t.at(-1) - t[0]), root, 0.005, `${k} pickup pitch`);
  }
  const kill = SOUNDS['confirm.kill'].layers;
  assert.deepEqual([kill.ka.f, kill.chunk.f, kill.chunk.at - (kill.ka.at ?? 0), kill.thump.f], [600, 300, 0.04, 90]);
  const fuse = SOUNDS['power.mine.fuse'].layers;
  assert.equal(fuse.b1.at - (fuse.b0.at ?? 0), 1 / 8, 'fuse beeps at 8 Hz');
  assert.equal(SOUNDS['power.shunt.lock'].layers.beep.f, 1600);
  near(beepRate(40), 3, 1e-9, 'lock at 40 m');
  near(beepRate(0), 9, 1e-9, 'lock at 0 m');
  assert.equal(beepRate(80), 3);
  assert.ok(beepRate(10) > beepRate(30));
});

test('the mix: the bible\'s bus numbers, levels in order, and headroom in every voice', () => {
  assert.equal(MIX.master, 0.6);
  assert.deepEqual([COMPRESSOR.threshold, COMPRESSOR.ratio, COMPRESSOR.attack, COMPRESSOR.release], [-12, 4, 0.003, 0.12]);
  assert.deepEqual([SLAP.delay, SLAP.db, SLAP.cutoff], [0.18, -14, 1500]);
  assert.deepEqual([WIND.level, WIND.lfo, ...WIND.band], [-30, 0.1, 300, 600]);
  assert.equal(SOUNDS['power.hum'].level, -32);
  assert.equal(SOUNDS['power.hum'].layers.hum.f, 110);
  assert.deepEqual([VOICE_LIMIT, CASING_DELAY, TRANSIENT_RANGE, HUM_RANGE, LAND.fullVy, LOCK.range], [48, 0.38, 25, 8, 6.3, 40]);
  const lv = (name) => SOUNDS[name].level;
  const order = ['power.mine.boom', 'gun.rifle', 'confirm.kill', 'confirm.hit', 'step.concrete', 'casing', 'wind', 'power.hum'];
  for (let i = 1; i < order.length; i++) assert.ok(lv(order[i - 1]) > lv(order[i]), `${order[i - 1]} over ${order[i]}`);
  assert.ok(lv('confirm.head') > lv('confirm.hit'), 'a headshot rings louder');
  // Each sound plays at its level, and no voice alone goes past full scale.
  for (const [name, r] of Object.entries(SOUNDS)) {
    const s = render(name);
    const gain = dbToGain(r.level) / shortTerm(s, FS, r.loop);
    assert.ok(peakOf(s) * gain <= 1, `${name} peaks at ${(20 * Math.log10(peakOf(s) * gain)).toFixed(1)} dB`);
  }
});

test('short-term level reads a full-scale sine as 0 dB', () => {
  const sine = Float32Array.from({ length: FS / 2 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / FS));
  near(shortTerm(sine, FS), 1, 0.01, 'sine');
  near(shortTerm(sine.map((v) => v / 10), FS), 0.1, 0.01, '-20 dB');
});

test('loops wrap without a seam', () => {
  for (const name of Object.keys(SOUNDS).filter((n) => SOUNDS[n].loop)) {
    const s = render(name);
    let step = 0;
    for (let i = 1; i < s.length; i++) step = Math.max(step, Math.abs(s[i] - s[i - 1]));
    assert.ok(Math.abs(s[0] - s.at(-1)) <= step, `${name}: seam ${Math.abs(s[0] - s.at(-1))}, largest step ${step}`);
  }
});

test('the reverb impulse decays, and its two channels are decorrelated', () => {
  const [l, r] = renderIR(FS, REVERB, shotRng(1, 2, 3));
  const tenth = Math.floor(l.length / 10);
  assert.ok(rms(l, l.length - tenth) < rms(l, 0, tenth) / 100);
  let lr = 0;
  for (let i = 0; i < l.length; i++) lr += l[i] * r[i];
  assert.ok(Math.abs(lr / (rms(l) * rms(r) * l.length)) < 0.2, 'channels correlate');
});

test('farther sounds are quieter, darker and relatively wetter', () => {
  const ds = [0, 2, 5, 10, 20, 40, 80];
  for (let i = 1; i < ds.length; i++) {
    const [near, far] = [ds[i - 1], ds[i]];
    assert.ok(distGain(far) < distGain(near));
    assert.ok(distCutoff(far) <= distCutoff(near));
    assert.ok(wetSend(far) / distGain(far) > wetSend(near) / distGain(near));
  }
});

test('shot ends are classified by the surface they hit', () => {
  const map = {
    boxes: [
      { pos: [0, -0.5, 0], size: [40, 1, 40], color: 0 },
      { pos: [3, 0.6, -2], size: [1.2, 1.2, 1.2], color: 3 },
      { pos: [8, 1.5, -9], size: [0.6, 3, 10], color: 1, surface: 'metal' },
      { pos: [-8, 1.5, -9], size: [0.6, 3, 10], color: 2 },
      { pos: [-8, 1, 9], size: [1, 2, 1], color: 5 },
    ],
  };
  const s = surfacesOf(map);
  const eye = [0, 1.6, 0];
  assert.deepEqual(classify(eye, [3, 0.6, -1.4], s), { surface: 'wood', axis: 2 }, 'the crate face toward us');
  assert.deepEqual(classify(eye, [2.5, 0, 1], s), { surface: 'concrete', axis: 1 }, 'the floor');
  assert.equal(classify(eye, [7.7005, 1, -9], s).surface, 'steel', 'its own surface wins (metal is steel), within the host rounding');
  assert.equal(classify(eye, [-7.7, 1, -9], s).surface, 'concrete', 'precast lane walls are concrete');
  assert.equal(classify(eye, [-7.5, 1, 9], s).surface, 'steel', 'rust is steel');
  assert.deepEqual(classify(eye, [0, 1.2, -5], s), { surface: 'flesh', axis: -1 }, 'stopped in mid-air: a player');
  assert.equal(classify(eye, [0, 1.6, -200], s), null, 'out of range: nothing hit');
  assert.equal(surfaceUnder({ x: 3.2, y: 1.2, z: -2.3 }, s), 'wood', 'standing on the crate');
  assert.equal(surfaceUnder({ x: 5, y: 0, z: 5 }, s), 'concrete', 'standing on the floor');
});

test('the variant picker never repeats the last variant, and uses them all', () => {
  const rand = shotRng(7, 7, 7);
  const seen = new Set();
  let last = -1;
  for (let i = 0; i < 500; i++) {
    const v = pickVariant(4, last, rand);
    assert.notEqual(v, last);
    assert.ok(v >= 0 && v < 4);
    seen.add(v);
    last = v;
  }
  assert.equal(seen.size, 4);
  assert.equal(pickVariant(1, 0, rand), 0);
});

test('voices never exceed the limit, and the oldest one a sound outranks is stolen', () => {
  const rand = shotRng(3, 3, 3);
  const voices = [];
  let stolen = 0;
  for (let n = 0; n < 2000; n++) {
    if (voices.length && rand() < 0.3) voices.splice(Math.floor(rand() * voices.length), 1); // some end
    const pri = Math.floor(rand() * 5);
    const i = voiceToSteal(voices, pri, VOICE_LIMIT);
    if (i === null) {
      assert.ok(voices.every((v) => v.pri > pri), 'dropped only when everything outranks it');
      continue;
    }
    if (i >= 0) {
      assert.ok(voices[i].pri <= pri && voices.slice(0, i).every((v) => v.pri > pri), 'the oldest it outranks');
      voices.splice(i, 1);
      stolen++;
    }
    voices.push({ pri, n });
    assert.ok(voices.length <= VOICE_LIMIT);
  }
  assert.ok(stolen > 0, 'the limit was reached');
});

test('power-up entities: Shunts fly, mines click as they arm and fuse, others sound once', () => {
  const seen = new Map();
  const heard = [];
  const step = (list) => diffEntities(seen, list, (what, e) => heard.push(`${what} ${e.id}`));
  step([{ id: 1, kind: 'shunt' }, { id: 2, kind: 'mine', state: 0 }, { id: 3, kind: 'bolt' }, { id: 4, kind: 'mine', armed: true }]);
  assert.deepEqual(heard.splice(0), ['fly 1', 'new 3'], 'mines seen for the first time say nothing, even armed');
  step([{ id: 1, kind: 'shunt' }, { id: 2, kind: 'mine', state: 1 }, { id: 3, kind: 'bolt' }, { id: 4, kind: 'mine', armed: true }]);
  assert.deepEqual(heard.splice(0), ['fly 1', 'arm 2']);
  step([{ id: 2, kind: 'mine', state: 2 }, { id: 4, kind: 'mine', armed: true }]);
  assert.deepEqual(heard.splice(0), ['fuse 2']);
  assert.deepEqual([...seen.keys()].sort(), [2, 4], 'gone ones are forgotten');
  step([{ id: 3, kind: 'bolt' }]);
  assert.deepEqual(heard.splice(0), ['new 3'], 'an id seen again after it left is new');
});

test('lock beeps: only an enemy Shunt heading at you, within range, the nearest one setting the rate', () => {
  const me = { x: 0, y: 0, z: 0 };
  const shunt = (z, vz, owner = 2, x = 0) => ({ kind: 'shunt', owner, x, y: 1, z, vx: 0, vy: 0, vz });
  const r = lockRate([shunt(20, -18)], me, 1);
  assert.ok(r > 3 && r < 9, `heading at you at 20 m: ${r}`);
  near(r, beepRate(20), 1e-9, 'rate by distance');
  assert.equal(lockRate([shunt(20, 18)], me, 1), 0, 'heading away');
  assert.equal(lockRate([shunt(20, -18, 1)], me, 1), 0, 'your own');
  assert.equal(lockRate([shunt(45, -18)], me, 1), 0, 'beyond 40 m');
  assert.equal(lockRate([shunt(20, -18, 2, 15)], me, 1), 0, 'aimed 37° off');
  assert.equal(lockRate([{ ...shunt(5, -18), kind: 'bolt' }], me, 1), 0, 'a Bolt is no lock');
  near(lockRate([shunt(30, -18), shunt(10, -18)], me, 1), beepRate(10), 1e-9, 'the nearest wins');
});

test('the output clipper leaves normal levels alone and never reaches -1 dBFS', () => {
  const { knee, range, ceiling } = CLIP;
  const n = 4097;
  const curve = clipCurve(n, knee, range, ceiling);
  const at = (x) => curve[Math.round(((x / range + 1) / 2) * (n - 1))];
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(0.5) - 0.5) < 0.005 && Math.abs(at(-0.5) + 0.5) < 0.005, 'identity below the knee');
  assert.ok(ceiling <= dbToGain(-1) && curve.every((v) => Math.abs(v) < ceiling), 'never past the ceiling');
  assert.ok(at(1) > 0.75 && at(range) > 0.88, 'loud peaks still read as loud');
  for (let i = 1; i < n; i++) assert.ok(curve[i] >= curve[i - 1], 'monotonic');
});
