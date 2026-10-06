// Procedural canvas textures for the world materials: seeded, tileable and
// drawn at load, so nothing is downloaded. Texels stay crisp up close
// (NearestFilter) and mipmapped with 4x anisotropy at a distance.
import * as THREE from 'three';

// Recipes. tile: metres one repeat covers (UVs are world metres); px: texels
// per metre (tile × px should be a power of two). Amounts are ± brightness.
export const TEXTURES = {
  // Poured slabs: per-slab tone, mottling, speckles, 1 px joints.
  concrete: { tile: 8, px: 32, seed: 11, base: '#a9a7a2', slab: 2, slabTone: 0.04, mottle: 0.07, speckle: 0.03, joint: 0.25 },
  // Grain plus wind ripples (ripples per tile), warped so they meander.
  sand: { tile: 4, px: 32, seed: 12, base: '#bcb3a2', grain: 0.07, mottle: 0.04, ripples: 12, ripple: 0.05, warp: 1.5 },
  // Square plates with dark seams, a lit bevel, rivets and brushed streaks.
  metal: { tile: 2, px: 64, seed: 13, base: '#8f9297', plate: 1, plateTone: 0.04, seam: 0.35, bevel: 0.1, rivet: 0.125, rivetLight: 0.22, streak: 0.06 },
  // Horizontal boards with gaps, staggered end joints and stretched grain.
  planks: { tile: 2, px: 64, seed: 14, base: '#9b896f', board: 0.25, boardTone: 0.07, gap: 0.45, grain: 0.12 },
  // Soft blotches and fine noise.
  plaster: { tile: 4, px: 32, seed: 15, base: '#b8b5af', blotch: 0.06, grain: 0.03 },
  // Diagonal two-tone stripes (width in metres).
  trim: { tile: 1, px: 64, seed: 16, base: '#b8b5af', stripe: '#4a4c51', width: 0.125, grain: 0.04 },
};

// Each painter calls put(x, y, brightness, colour?) once per texel.
const PAINTERS = {
  concrete(r, size, put) {
    const slab = r.slab * r.px;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let k = 1 + r.slabTone * signed(hash(Math.floor(x / slab), Math.floor(y / slab), r.seed));
        k += r.mottle * signed(fbm(x, y, size, r.tile, r.seed));
        const s = hash(x, y, r.seed + 1);
        if (s < r.speckle) k -= 0.12;
        else if (s > 1 - r.speckle) k += 0.08;
        if (x % slab === 0 || y % slab === 0) k -= r.joint;
        put(x, y, k);
      }
    }
  },
  sand(r, size, put) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const phase = (y / size) * r.ripples + r.warp * fbm(x, y, size, 3, r.seed);
        let k = 1 + r.ripple * Math.sin(phase * 2 * Math.PI);
        k += r.mottle * signed(fbm(x, y, size, r.tile * 2, r.seed + 1)) + r.grain * signed(hash(x, y, r.seed + 2));
        put(x, y, k);
      }
    }
  },
  metal(r, size, put) {
    const plate = r.plate * r.px;
    const rivet = r.rivet * r.px;
    const inset = 3;
    const onRow = (p) => Math.abs(p - inset - 0.5) <= 0.5 || Math.abs(p - (plate - inset - 1.5)) <= 0.5; // 2 px wide
    const onBeat = (p) => (p + rivet / 2) % rivet < 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = x % plate;
        const py = y % plate;
        let k = 1 + r.plateTone * signed(hash(Math.floor(x / plate), Math.floor(y / plate), r.seed));
        k += r.streak * signed(noise(x, y, size, 2, size / 2, r.seed + 1));
        if (px === 0 || py === 0) k -= r.seam;
        else if (px === 1 || py === 1) k += r.bevel;
        else if ((onRow(px) && onBeat(py)) || (onRow(py) && onBeat(px))) k += r.rivetLight;
        put(x, y, k);
      }
    }
  },
  planks(r, size, put) {
    const board = r.board * r.px;
    for (let y = 0; y < size; y++) {
      const row = Math.floor(y / board);
      const shift = Math.floor(hash(row, 0, r.seed) * size); // where this board's end joint falls
      const tone = 1 + r.boardTone * signed(hash(row, 1, r.seed));
      for (let x = 0; x < size; x++) {
        let k = tone + r.grain * signed(noise(x, y, size, 3, (size / board) * 6, r.seed + row));
        if (y % board === 0 || (x + shift) % size === 0) k -= r.gap;
        put(x, y, k);
      }
    }
  },
  plaster(r, size, put) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) put(x, y, 1 + r.blotch * signed(fbm(x, y, size, r.tile, r.seed)) + r.grain * signed(hash(x, y, r.seed + 1)));
    }
  },
  trim(r, size, put) {
    const width = r.width * r.px;
    const stripe = rgb(r.stripe);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) put(x, y, 1 + r.grain * signed(hash(x, y, r.seed)), Math.floor((x + y) / width) % 2 ? stripe : undefined);
    }
  },
};

// A world texture by recipe name: repeats every recipe.tile metres of world-metre UVs.
export function makeTexture(name) {
  const r = TEXTURES[name];
  const size = Math.round(r.tile * r.px);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const base = rgb(r.base);
  PAINTERS[name](r, size, (x, y, k, color = base) => {
    const i = (y * size + x) * 4;
    image.data[i] = color[0] * k;
    image.data[i + 1] = color[1] * k;
    image.data[i + 2] = color[2] * k;
    image.data[i + 3] = 255;
  });
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.anisotropy = 4;
  texture.repeat.setScalar(1 / r.tile);
  return texture;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const signed = (v) => v * 2 - 1;
const smooth = (t) => t * t * (3 - 2 * t);

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
