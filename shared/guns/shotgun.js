// Crusher: 12 × 10 = 120, so a full blast kills 100 HP but not a Shield's
// 160. Pellets fall from full at 8 m to a fifth at 18 m. Fields: docs/guns.md.
export default {
  id: 'shotgun', name: 'Crusher', slot: 'primary', class: 'shotgun',
  dmg: 10, head: 2, pellets: 12, rps: 1.1, mode: 'semi', mag: 5, reload: 0.5, perShell: true,
  spreadStand: 3.5, spreadMove: 3.5, falloff: { from: 8, to: 18, min: 0.2 }, kick: [2.5, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -5, n: 3, drive: 2.5, slap: true, layers: { // sound: a dark blast, then the pump (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 900, q: 0.6, a: 0.001, dur: 0.3 },
    thump: { src: 'sine', f: 70, f1: 35, sweep: 0.18, a: 0.002, dur: 0.18 },
    tail: { src: 'noise', mode: 'lp', f: 1300, f1: 250, glide: 0.2, a: 0.01, d: 0.2, g: 0.35 },
    pumpBack: { src: 'noise', mode: 'bp', f: 1700, q: 2, at: 0.42, a: 0.002, d: 0.022, g: 0.16 },
    pumpFwd: { src: 'noise', mode: 'bp', f: 2600, q: 2.5, at: 0.55, a: 0.001, d: 0.016, g: 0.2 },
  } },
  icon: null, // hud workstream: the SVG path
};
