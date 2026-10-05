// Seeded randomness for spread and pellets. Client and server seed each shot
// identically, so the tracer drawn at once and the ray the server tests
// roll the same numbers.

// mulberry32: tiny, fast, good enough for spread.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One generator per (server seed, player id, shot number).
export const shotRng = (seed, player, shot) =>
  mulberry32(Math.imul(seed ^ Math.imul(player + 1, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(shot + 1, 0xc2b2ae35));
