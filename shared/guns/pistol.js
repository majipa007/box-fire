// Rivet: the launch sidearm. Fields: docs/guns.md.
export default {
  id: 'pistol', name: 'Rivet', slot: 'secondary', class: 'pistol',
  dmg: 26, head: 3, rps: 6.75, mode: 'semi', mag: 12, reload: 1.75,
  spreadStand: 0.3, spreadMove: 1.5, falloff: { from: 25, to: 40, min: 0.75 }, kick: [0.9, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -9, n: 4, drive: 1.8, slap: true, layers: { // sound: a snappy pop and the slide (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 3200, q: 1.1, a: 0.0004, dur: 0.08 },
    thump: { src: 'sine', f: 90, f1: 45, sweep: 0.12, a: 0.001, dur: 0.12, g: 0.7 },
    tail: { src: 'noise', mode: 'lp', f: 2600, f1: 500, glide: 0.08, a: 0.004, d: 0.07, g: 0.22 },
    slide: { src: 'noise', mode: 'bp', f: 3800, q: 3, at: 0.04, a: 0.0005, d: 0.005, g: 0.18 },
  } },
  icon: null, // hud workstream: the SVG path
};
