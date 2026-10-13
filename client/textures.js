// Procedural canvas textures for the map materials (bible §2.5): seeded,
// tileable and drawn at load, so nothing is downloaded. Texels stay crisp up
// close (NearestFilter) and mipmapped with 4x anisotropy at a distance.
// Noise is zero-mean, so a patch of open surface averages to its base colour.
import * as THREE from 'three';

// size: metres one repeat covers [u, v] (UVs are world metres); px: texels per
// metre. faceLocal: the bake gives this material one UV unit per tile instead.
export const TEXTURES = {
  // Poured slabs: 4 m slabs with 2 px joints, mottling, speckles, hairline cracks.
  slab: { size: [8, 8], px: 32, seed: 11, base: '#b7b0a3', joint: '#8f887d', specks: ['#9f988c', '#cbc5ba'], speck: 0.03, crack: '#9a9387', cracks: 3, noise: 0.05, slabTone: 0.03 },
  // Board-formed walls, exactly 4 m tall: 0.25 m board lines, tie holes, rain streaks, coping.
  board: { size: [4, 4], px: 32, seed: 12, base: '#c9c3b8', line: '#b9b3a8', boardTone: 0.04, tie: '#7d776d', ties: [3, 0.6], streak: '#8f887d', streaks: 7, coping: '#d9d4ca', copingHeight: 0.3, noise: 0.03 },
  // Precast lane panels, exactly 3 m tall: 2 m panels, a teal height band, lifting recesses.
  precast: { size: [2, 3], px: 32, seed: 13, base: '#b5afa4', seam: '#8f887d', chip: '#c9c3b8', chips: 0.08, band: '#5f7f7c', bandY: [1, 1.15], recess: '#8f887d', recessY: 2.6, noise: 0.04 },
  // Crates: 0.3 m boards in a batten frame with a diagonal brace (one 1.2 m face per tile).
  plywood: { size: [1.2, 1.2], px: 53.33, faceLocal: true, seed: 14, base: '#a38763', batten: '#8c7253', board: 0.3, frame: 0.08, boardTone: 0.05, grain: 0.06 },
  // Corrugated steel: vertical ribs, rust blooms and drips.
  rust: { size: [2, 2], px: 32, seed: 15, base: '#8a5a44', rib: 0.08, ribPx: 3, bloom: '#6f4535', blooms: 0.2, drip: '#6f4535', drips: 6, noise: 0.04 },
  // Gabion baskets: stones with dark outlines behind a 0.5 m wire grid.
  dock: { size: [4, 4], px: 32, seed: 16, stone: '#9d968a', outline: '#6f685e', stones: 90, stoneTone: 0.08, wire: '#45474c', wireAlpha: 0.7, wireEvery: 0.5 },
};

const PAINTERS = {
  slab(r, w, h, set, rand) {
    const slab = (r.px * r.size[0]) / 2; // 4 m slabs: 2 × 2 per tile
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = 1 + r.slabTone * signed(hash(Math.floor(x / slab), Math.floor(y / slab), r.seed)) + r.noise * signed(fbm(x, y, w, 8, r.seed));
        const s = hash(x, y, r.seed + 1);
        set(x, y, s < r.speck / 2 ? rgb(r.specks[0]) : s > 1 - r.speck / 2 ? rgb(r.specks[1]) : shade(rgb(r.base), k));
        if (x % slab < 2 || y % slab < 2) set(x, y, rgb(r.joint));
      }
    }
    for (let i = 0; i < r.cracks; i++) walk(rand, w, h, 20 + rand() * 40, (x, y) => set(x, y, rgb(r.crack)));
  },
  board(r, w, h, set, rand) {
    const board = r.px / 4; // 0.25 m
    const coping = Math.round(r.copingHeight * r.px);
    for (let y = 0; y < h; y++) {
      const tone = 1 + r.boardTone * signed(hash(0, Math.floor(y / board), r.seed));
      for (let x = 0; x < w; x++) {
        const k = 1 + r.noise * signed(fbm(x, y, w, 4, r.seed + 1));
        if (y < coping) set(x, y, shade(rgb(r.coping), k));
        else if (y === coping) set(x, y, shade(rgb(r.line), 0.9)); // the drip line under the coping
        else set(x, y, (y - coping) % board === 0 ? rgb(r.line) : shade(rgb(r.base), tone * k));
      }
    }
    for (let i = 0; i < r.streaks; i++) {
      const x = Math.floor(rand() * w);
      const len = 20 + rand() * 40;
      for (let y = coping + 1; y < coping + 1 + len; y++) blend(set.get, set, x, y, rgb(r.streak), 0.1 * (1 - (y - coping) / len));
    }
    const [across, rowEvery] = r.ties;
    for (let i = 0; i < across; i++) {
      for (let m = rowEvery; m < 4 - r.copingHeight; m += rowEvery) {
        const x = Math.round(((i + 0.5) * w) / across);
        const y = Math.round(h - m * r.px);
        for (let d = 0; d < 4; d++) set(x + (d & 1), y + (d >> 1), rgb(r.tie));
      }
    }
  },
  precast(r, w, h, set, rand) {
    const row = (m) => Math.round(h - m * r.px); // canvas row of a height in metres
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = 1 + r.noise * signed(fbm(x, (y * w) / h, w, 2, r.seed)) + 0.03 * signed(hash(x, y, r.seed + 1));
        set(x, y, y > row(r.bandY[1]) && y <= row(r.bandY[0]) ? shade(rgb(r.band), k) : shade(rgb(r.base), k));
        if (x === 0 || x === w - 1) set(x, y, rgb(r.seam));
        else if ((x === 1 || x === w - 2) && rand() < r.chips) set(x, y, rgb(r.chip));
      }
    }
    for (const cx of [w / 4, (3 * w) / 4]) {
      for (let d = 0; d < 16; d++) set(cx - 2 + (d & 3), row(r.recessY) - 2 + (d >> 2), rgb(r.recess));
    }
  },
  plywood(r, w, h, set) {
    const board = Math.round(r.board * r.px);
    const frame = Math.round(r.frame * r.px);
    for (let y = 0; y < h; y++) {
      const tone = 1 + r.boardTone * signed(hash(0, Math.floor(y / board), r.seed));
      for (let x = 0; x < w; x++) {
        const k = tone + r.grain * signed(noise(x, y, w, 3, 24, r.seed + Math.floor(y / board)));
        set(x, y, y % board === 0 ? rgb(r.batten) : shade(rgb(r.base), k));
        // Battens: the frame and the brace, lit along their top and left edges.
        const brace = Math.abs(x - (h - 1 - y)) < frame / 1.4;
        const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (edge < frame || brace) {
          const lit = edge === 0 || (brace && Math.abs(x - (h - 1 - y)) >= frame / 1.4 - 1 && x < h - 1 - y);
          const dark = edge === frame - 1 && !brace;
          set(x, y, shade(rgb(r.batten), lit ? 1.12 : dark ? 0.82 : 1 + 0.04 * signed(hash(x, y, r.seed))));
        }
      }
    }
  },
  rust(r, w, h, set, rand) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = 1 + r.rib * Math.sin((2 * Math.PI * x) / r.ribPx) + r.noise * signed(hash(x, y, r.seed));
        set(x, y, fbm(x, y, w, 8, r.seed + 1) > 1 - r.blooms * 1.6 ? shade(rgb(r.bloom), k) : shade(rgb(r.base), k));
      }
    }
    for (let i = 0; i < r.drips; i++) {
      const x = Math.floor(rand() * w);
      const y0 = Math.floor(rand() * h);
      for (let y = y0; y < y0 + 8 + rand() * 20; y++) blend(set.get, set, x, y % h, rgb(r.drip), 0.5);
    }
  },
  dock(r, w, h, set, rand) {
    const seeds = Array.from({ length: r.stones }, () => [rand() * w, rand() * h, 1 + r.stoneTone * signed(rand())]);
    const wire = Math.round(r.wireEvery * r.px);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Nearest and second-nearest stone centre (wrapped), for cells with outlines.
        let d1 = Infinity;
        let d2 = Infinity;
        let k = 1;
        for (const [sx, sy, tone] of seeds) {
          const dx = Math.min(Math.abs(x - sx), w - Math.abs(x - sx));
          const dy = Math.min(Math.abs(y - sy), h - Math.abs(y - sy));
          const d = Math.hypot(dx, dy);
          if (d < d1) [d2, d1, k] = [d1, d, tone];
          else if (d < d2) d2 = d;
        }
        set(x, y, d2 - d1 < 1.2 ? rgb(r.outline) : shade(rgb(r.stone), k * (1.06 - 0.12 * Math.min(1, d1 / 7))));
        if (x % wire === 0 || y % wire === 0) blend(set.get, set, x, y, rgb(r.wire), r.wireAlpha);
      }
    }
  },
};

// A map texture by recipe name; repeats every recipe.size metres of world-metre UVs.
export function makeTexture(name) {
  const r = TEXTURES[name];
  const w = Math.round(r.size[0] * r.px);
  const h = Math.round(r.size[1] * r.px);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(w, h);
  const wrap = (x, y) => ((((Math.round(y) % h) + h) % h) * w + (((Math.round(x) % w) + w) % w)) * 4;
  const set = (x, y, c) => {
    const i = wrap(x, y);
    image.data[i] = c[0];
    image.data[i + 1] = c[1];
    image.data[i + 2] = c[2];
    image.data[i + 3] = 255;
  };
  set.get = (x, y) => {
    const i = wrap(x, y);
    return [image.data[i], image.data[i + 1], image.data[i + 2]];
  };
  PAINTERS[name](r, w, h, set, seeded(r.seed));
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4; // three.js clamps to the GPU's maximum
  if (!r.faceLocal) texture.repeat.set(1 / r.size[0], 1 / r.size[1]);
  return texture;
}

// The decal atlas: white shapes with alpha (decals tint them by vertex colour). Returns
// { texture, cells: { name: [u0, v0, u1, v1, width / height] } }. Spray-painted text and
// marks lose random pixels, so they read worn.
export function makeDecalAtlas() {
  const W = 512;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const cells = {};
  const rand = seeded(21);
  let x = 0;
  let y = 0;
  let row = 0;
  const cell = (name, w, h, draw, worn = 0) => {
    if (x + w > W) [x, y, row] = [0, y + row + 4, 0];
    g.save();
    g.translate(x, y);
    g.fillStyle = g.strokeStyle = '#fff';
    draw(g, w, h);
    g.restore();
    if (worn) {
      const img = g.getImageData(x, y, w, h);
      for (let i = 3; i < img.data.length; i += 4) if (rand() < worn) img.data[i] *= 0.35;
      g.putImageData(img, x, y);
    }
    cells[name] = [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H, w / h];
    x += w + 4;
    row = Math.max(row, h);
  };
  const text = (label, font) => (c, w, h) => {
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, w / 2, h / 2 + h * 0.04);
  };
  const STENCIL = (px) => `bold ${px}px "DejaVu Sans Mono", "Courier New", monospace`;
  cell('solid', 8, 8, (c, w, h) => c.fillRect(0, 0, w, h));
  for (const n of ['01', '02', '03', '04']) cell(n, 72, 60, text(n, STENCIL(58)), 0.12);
  cell('PIT 7', 200, 60, text('PIT 7', STENCIL(58)), 0.15);
  for (const n of ['BX-01', 'BX-02', 'BX-03', 'BX-04']) cell(n, 120, 30, text(n, STENCIL(28)), 0.1);
  cell('BOXFIRE', 252, 48, text('BOXFIRE', STENCIL(48)));
  cell('QUARRY CO.', 330, 40, text('QUARRY CO.', STENCIL(38)));
  cell('grate', 48, 48, (c, w, h) => {
    c.fillRect(0, 0, w, 3);
    c.fillRect(0, h - 3, w, 3);
    c.fillRect(0, 0, 3, h);
    c.fillRect(w - 3, 0, 3, h);
    for (let k = 6; k < w - 4; k += 5) c.fillRect(k, 5, 2, h - 10);
  });
  for (const n of [0, 1]) {
    cell(`crack${n}`, 96, 24, (c, w, h) => {
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(2, h / 2);
      for (let k = 1; k <= 12; k++) c.lineTo(2 + ((w - 4) * k) / 12, h / 2 + (rand() - 0.5) * h * 0.7);
      c.stroke();
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(w * 0.4, h / 2);
      c.lineTo(w * 0.55, h * (n ? 0.1 : 0.9));
      c.stroke();
    });
  }
  cell('oil', 64, 64, (c, w, h) => {
    for (let k = 0; k < 7; k++) {
      const r = 8 + rand() * 18;
      const grad = c.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      c.setTransform(1, 0, 0, 1, x + w / 2 + (rand() - 0.5) * 24, y + h / 2 + (rand() - 0.5) * 24);
      c.fillStyle = grad;
      c.fillRect(-r, -r, 2 * r, 2 * r);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return { texture, cells };
}

// Chain-link: 1 px galvanised wires in diamonds with a top rail, as alpha, one 1.4 m tile.
export function makeFenceTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const image = g.createImageData(size, size);
  const wire = rgb('#b4b8bd');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = (x + y) % 8 === 0 || (x - y + size) % 8 === 0 || y < 2 || y === size - 1;
      image.data.set([...shade(wire, y < 2 ? 0.8 : 1), on ? 255 : 0], i);
    }
  }
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const shade = (c, k) => c.map((v) => Math.min(255, v * k));
const signed = (v) => v * 2 - 1;
const smooth = (t) => t * t * (3 - 2 * t);
const blend = (get, set, x, y, c, a) => set(x, y, get(x, y).map((v, i) => v + (c[i] - v) * a));

// A random walk of n pixels from a random start: hairline cracks.
function walk(rand, w, h, n, plot) {
  let x = rand() * w;
  let y = rand() * h;
  let angle = rand() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    plot(x, y);
    angle += (rand() - 0.5) * 1.2;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
}

function seeded(seed) {
  let i = 0;
  return () => hash(i++, 7, seed);
}

// Integer hash → [0, 1).
function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable value noise with cx × cy lattice cells across a size-px tile.
function noise(x, y, size, cx, cy, seed) {
  const fx = (x / size) * cx;
  const fy = (y / size) * cy;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = (x0 + 1) % cx;
  const y1 = (y0 + 1) % cy;
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const top = hash(x0, y0, seed) * (1 - tx) + hash(x1, y0, seed) * tx;
  const bottom = hash(x0, y1, seed) * (1 - tx) + hash(x1, y1, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

// Three octaves, starting at `cells` lattice cells per tile.
const fbm = (x, y, size, cells, seed) =>
  (4 * noise(x, y, size, cells, cells, seed) + 2 * noise(x, y, size, cells * 2, cells * 2, seed + 1) + noise(x, y, size, cells * 4, cells * 4, seed + 2)) / 7;
