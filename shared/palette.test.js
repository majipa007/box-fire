// Readability guard for the palette (docs/bible.md §2.1): player slots, power-up
// hues and map materials must stay far apart in CIEDE2000 (Sharma 2005, D65
// sRGB → Lab), and map materials must stay low-chroma in OKLCH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PLAYER_COLORS, POWER_COLORS } from './constants.js';

const linear = (hex) => [1, 3, 5].map((i) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

function lab(hex) {
  const [r, g, b] = linear(hex);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const DEG = Math.PI / 180;
export function de00Lab([L1, a1, b1], [L2, a2, b2]) {
  const c7 = ((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(c7 / (c7 + 25 ** 7)));
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
  const C1 = Math.hypot(A1, b1), C2 = Math.hypot(A2, b2);
  const hue = (b, a) => (Math.atan2(b, a) / DEG + 360) % 360;
  const h1 = hue(b1, A1), h2 = hue(b2, A2);
  let dh = h2 - h1;
  if (C1 * C2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * DEG);
  const L = (L1 + L2) / 2, C = (C1 + C2) / 2;
  let H = h1 + h2;
  if (C1 * C2 !== 0) H = (Math.abs(h1 - h2) > 180 ? H + (H < 360 ? 360 : -360) : H) / 2;
  const T = 1 - 0.17 * Math.cos((H - 30) * DEG) + 0.24 * Math.cos(2 * H * DEG) + 0.32 * Math.cos((3 * H + 6) * DEG) - 0.2 * Math.cos((4 * H - 63) * DEG);
  const SL = 1 + (0.015 * (L - 50) ** 2) / Math.sqrt(20 + (L - 50) ** 2), SC = 1 + 0.045 * C, SH = 1 + 0.015 * C * T;
  const RT = -Math.sin(60 * Math.exp(-(((H - 275) / 25) ** 2)) * DEG) * 2 * Math.sqrt(C ** 7 / (C ** 7 + 25 ** 7));
  const l = (L2 - L1) / SL, c = (C2 - C1) / SC, h = dH / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}
export const de00 = (p, q) => de00Lab(lab(p), lab(q));

export function oklchChroma(hex) {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.hypot(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}

const pairs = (xs, ys) => (ys ? xs.flatMap((x) => ys.map((y) => [x, y])) : xs.flatMap((x, i) => xs.slice(i + 1).map((y) => [x, y])));
const closest = (ps) => Math.min(...ps.map(([x, y]) => de00(x, y)));
const items = Object.values(POWER_COLORS);

test('CIEDE2000 matches the Sharma 2005 reference pairs', () => {
  // Pairs 1, 7, 17, 25 and 33 of Sharma, Wu and Dalal (2005).
  const SHARMA = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [p, q, want] of SHARMA) assert.ok(Math.abs(de00Lab(p, q) - want) < 1e-4, `${de00Lab(p, q)} vs ${want}`);
  assert.ok(Math.abs(de00('#000000', '#ffffff') - 100) < 0.01);
});

test('player slots stay apart from each other', () => {
  assert.ok(closest(pairs(PLAYER_COLORS)) >= 15);
});

test('power-up hues stay apart from slots and from each other', () => {
  assert.ok(closest(pairs(items, PLAYER_COLORS)) >= 13.5);
  assert.ok(closest(pairs(items)) >= 18);
});

test('map materials stay muted and far from actors', async () => {
  const map = JSON.parse(await readFile(new URL('./maps/arena_01.json', import.meta.url)));
  if (!map.materials) return; // the world rework adds them
  const surfaces = map.materials.flatMap((m) => [m.base, ...m.accents]);
  assert.ok(closest(pairs(surfaces, PLAYER_COLORS)) >= 18);
  assert.ok(closest(pairs(surfaces, items)) >= 9);
  for (const s of surfaces) assert.ok(oklchChroma(s) <= 0.08, `${s} chroma ${oklchChroma(s).toFixed(3)}`);
});
