// Plumb: semi-auto, no scope. Two body hits kill at any range, a headshot
// always does; stand still to shoot it. Fields: docs/guns.md.
export default {
  id: 'marksman', name: 'Plumb', slot: 'primary', class: 'marksman',
  dmg: 55, head: 2.5, rps: 2.75, mode: 'semi', mag: 10, reload: 2.4,
  spreadStand: 0.05, spreadMove: 3, kick: [2.2, 0], speed: 0.95,
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -6, n: 4, drive: 2.4, send: 1.4, slap: true, layers: { // sound: a hard crack and a rolling tail (client/audio.js)
    crack: { src: 'noise', mode: 'hp', f: 3200, a: 0.0002, dur: 0.02, g: 0.7 },
    body: { src: 'noise', mode: 'bp', f: 1900, q: 0.9, a: 0.0005, dur: 0.16 },
    thump: { src: 'sine', f: 85, f1: 40, sweep: 0.14, a: 0.001, dur: 0.16, g: 0.95 },
    tail: { src: 'noise', mode: 'lp', f: 1700, f1: 280, glide: 0.25, a: 0.01, d: 0.2, g: 0.36 },
    action: { src: 'noise', mode: 'bp', f: 3000, q: 3, at: 0.09, a: 0.0005, d: 0.006, g: 0.13 },
  } },
  icon: null, // hud workstream: the SVG path
};
