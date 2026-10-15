// Nailer: a sidearm that sprays. Fast and close, it climbs and blooms hard
// and falls off quickly. Fields: docs/guns.md.
export default {
  id: 'machinepistol', name: 'Nailer', slot: 'secondary', class: 'machinepistol',
  dmg: 18, head: 2.5, rps: 16, mode: 'auto', mag: 18, reload: 1.6,
  spreadStand: 0.9, spreadMove: 1.6, falloff: { from: 6, to: 18, min: 0.5 }, bloom: 0.3, bloomMax: 3, kick: [0.5, 0.18],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -11, n: 5, drive: 1.8, slap: true, layers: { // sound: a light, thin rattle (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 3800, q: 1.3, a: 0.0003, dur: 0.04 },
    snap: { src: 'noise', mode: 'hp', f: 5500, a: 0.0002, dur: 0.012, g: 0.5 },
    thump: { src: 'sine', f: 150, f1: 90, sweep: 0.035, a: 0.0008, dur: 0.045, g: 0.35 },
    tail: { src: 'noise', mode: 'lp', f: 3200, f1: 800, glide: 0.04, a: 0.003, d: 0.03, g: 0.16 },
    rattle: { src: 'noise', mode: 'bp', f: 4400, q: 3, at: 0.022, a: 0.0004, d: 0.004, g: 0.2 },
  } },
  icon: null, // hud workstream: the SVG path
};
