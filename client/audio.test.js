import test from 'node:test';
import assert from 'node:assert/strict';
import { shotRng } from '../shared/rng.js';
import {
  SOUNDS, REVERB, renderSound, renderIR, distGain, distCutoff, wetSend, surfacesOf, classify, surfaceUnder, pickVariant, clipCurve,
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
const render = (name, variant = 0) => renderSound(SOUNDS[name], FS, shotRng(1, 2, variant));

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
  assert.deepEqual(render('gun.rifle', 0), render('gun.rifle', 0));
  assert.notDeepEqual(render('gun.rifle', 0), render('gun.rifle', 1));
});

test('gunshots hit at once and die away', () => {
  for (const w of ['rifle', 'pistol', 'shotgun']) {
    const s = render(`gun.${w}`);
    const loudest = s.findIndex((v) => Math.abs(v) === peakOf(s));
    assert.ok(loudest < ms(15), `${w} peaks at ${loudest / 48} ms`);
    assert.ok(rms(s, s.length - ms(20)) < rms(s, 0, ms(30)) / 50, `${w} tail`);
  }
});

test('the shotgun is darker than the rifle, and the rifle darker than the pistol', () => {
  const [pistol, rifle, shotgun] = ['pistol', 'rifle', 'shotgun'].map((w) => brightness(render(`gun.${w}`), ms(60)));
  assert.ok(pistol > rifle && rifle > shotgun, `pistol ${pistol}, rifle ${rifle}, shotgun ${shotgun}`);
});

test('the boost loop wraps without a seam', () => {
  const s = render('power.boost');
  let step = 0;
  for (let i = 1; i < s.length; i++) step = Math.max(step, Math.abs(s[i] - s[i - 1]));
  assert.ok(Math.abs(s[0] - s.at(-1)) <= step, `seam ${Math.abs(s[0] - s.at(-1))}, largest step ${step}`);
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
    ],
  };
  const s = surfacesOf(map);
  const eye = [0, 1.6, 0];
  assert.deepEqual(classify(eye, [3, 0.6, -1.4], s), { surface: 'wood', axis: 2 }, 'the crate face toward us');
  assert.deepEqual(classify(eye, [2.5, 0, 1], s), { surface: 'concrete', axis: 1 }, 'the floor');
  assert.equal(classify(eye, [7.7005, 1, -9], s).surface, 'metal', 'its own surface wins, within the host rounding');
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

test('the output clipper leaves normal levels alone and never reaches full scale', () => {
  const [n, knee, range] = [4097, 0.6, 4];
  const curve = clipCurve(n, knee, range);
  const at = (x) => curve[Math.round(((x / range + 1) / 2) * (n - 1))];
  assert.equal(at(0), 0);
  assert.ok(Math.abs(at(0.5) - 0.5) < 0.005 && Math.abs(at(-0.5) + 0.5) < 0.005, 'identity below the knee');
  assert.ok(curve.every((v) => Math.abs(v) < 1), 'never full scale');
  assert.ok(at(1) > 0.8 && at(range) > 0.99, 'loud peaks still read as loud');
  for (let i = 1; i < n; i++) assert.ok(curve[i] >= curve[i - 1], 'monotonic');
});
