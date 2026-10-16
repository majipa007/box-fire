// Ratchet: three rounds a click, tight and steady, for the mid range where
// the Mason's spray blooms off target. rps is the sustained rate the burst
// numbers give: count / (count / burst.rps + delay). Fields: docs/guns.md.
export default {
  id: 'burst', name: 'Ratchet', slot: 'primary', class: 'burst',
  dmg: 26, head: 3, rps: 8.57, mode: 'burst', burst: { count: 3, rps: 20, delay: 0.2 }, mag: 21, reload: 2.4,
  spreadStand: 0.08, spreadMove: 3, falloff: { from: 22, to: 40, min: 0.7 }, bloom: 0.1, bloomMax: 0.8, kick: [0.35, 0.1],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -8, n: 4, drive: 2.2, slap: true, layers: { // sound: one crisp, tight round; a click fires three (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 2600, q: 1.4, a: 0.0004, dur: 0.045 },
    snap: { src: 'noise', mode: 'hp', f: 4800, a: 0.0002, dur: 0.01, g: 0.45 },
    thump: { src: 'sine', f: 110, f1: 60, sweep: 0.04, a: 0.0008, dur: 0.05, g: 0.7 },
    tail: { src: 'noise', mode: 'lp', f: 2400, f1: 500, glide: 0.04, a: 0.003, d: 0.025, g: 0.2 },
    ratchet: { src: 'noise', mode: 'bp', f: 3600, q: 4, at: 0.028, a: 0.0003, d: 0.003, g: 0.14 },
  } },
  icon: null, // hud workstream: the SVG path
};
