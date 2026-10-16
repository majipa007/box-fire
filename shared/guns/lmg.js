// Piledriver: a 75-round belt to hold a lane with. Slow to carry, slower
// while it fires, long to reload, and its recoil keeps climbing.
// Fields: docs/guns.md.
export default {
  id: 'lmg', name: 'Piledriver', slot: 'primary', class: 'lmg',
  dmg: 25, head: 2.5, rps: 9.5, mode: 'auto', mag: 75, reload: 4.5,
  spreadStand: 0.25, spreadMove: 4.5, falloff: { from: 20, to: 35, min: 0.7 }, bloom: 0.15, bloomMax: 1.5, kick: [0.4, 0.15], speed: 0.88, fireSpeed: 0.6,
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -6, n: 6, vary: 0.03, drive: 2.4, send: 1.2, slap: true, layers: { // sound: heavy and steady, the belt clinking (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 1400, q: 0.8, a: 0.0008, dur: 0.1 },
    thump: { src: 'sine', f: 76, f1: 38, sweep: 0.1, a: 0.0012, dur: 0.11, g: 1.25, partials: [[1, 1, 1], [2, 0.3, 0.6]] },
    tail: { src: 'noise', mode: 'lp', f: 1500, f1: 300, glide: 0.08, a: 0.005, d: 0.05, g: 0.32 },
    belt: { src: 'noise', mode: 'bp', f: 2300, q: 2.5, at: 0.055, a: 0.0005, d: 0.006, g: 0.1 },
    link: { src: 'sine', f: 3100, at: 0.06, a: 0.0002, d: 0.008, g: 0.05, partials: [[1, 1, 1], [2.756, 0.45, 0.55]] },
  } },
  icon: { w: 52, h: 16, d: 'M1 3.5 L11 4 V2.5 H30 V4 H42 V5 H51 V7 H42 V8 H27 V14 H19 V9 H16.5 L15.5 14 H12.5 L13 9 H11 L1 10.5 Z M38.5 7.5 H40.5 L37.5 15.5 H35.5 Z M39.5 7.5 H41.5 L45 15.5 H43 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
