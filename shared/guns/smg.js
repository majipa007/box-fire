// Grinder: very fast, light, and as accurate on the move as standing; the
// damage falls away past 10 m. Fields: docs/guns.md.
export default {
  id: 'smg', name: 'Grinder', slot: 'primary', class: 'smg',
  dmg: 20, head: 2.5, rps: 15, mode: 'auto', mag: 30, reload: 2.1,
  spreadStand: 0.6, spreadMove: 1.1, falloff: { from: 10, to: 22, min: 0.6 }, bloom: 0.1, bloomMax: 1.2, kick: [0.15, 0.06],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -10, n: 5, drive: 2, slap: true, layers: { // sound: a quick buzzing chatter (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 2900, q: 1.1, a: 0.0004, dur: 0.06 },
    snap: { src: 'noise', mode: 'hp', f: 4500, a: 0.0002, dur: 0.012, g: 0.35 },
    thump: { src: 'sine', f: 120, f1: 65, sweep: 0.05, a: 0.0008, dur: 0.06, g: 0.5 },
    tail: { src: 'noise', mode: 'lp', f: 2600, f1: 550, glide: 0.05, a: 0.004, d: 0.035, g: 0.2 },
    bolt: { src: 'noise', mode: 'bp', f: 3400, q: 3, at: 0.03, a: 0.0004, d: 0.004, g: 0.16 },
  } },
  icon: null, // hud workstream: the SVG path
};
