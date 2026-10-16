// Sledge: a heavy revolver. Two body hits kill, a headshot always does; it
// kicks hard and fires slowly. Fields: docs/guns.md.
export default {
  id: 'handcannon', name: 'Sledge', slot: 'secondary', class: 'handcannon',
  dmg: 50, head: 3, rps: 2.2, mode: 'semi', mag: 6, reload: 2.25,
  spreadStand: 0.25, spreadMove: 2.5, falloff: { from: 20, to: 40, min: 0.7 }, kick: [3.5, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -5, n: 4, drive: 2.6, send: 1.3, slap: true, layers: { // sound: a deep boom, then the cylinder turning (client/audio.js)
    crack: { src: 'noise', mode: 'bp', f: 2600, q: 0.8, a: 0.0004, dur: 0.045, g: 0.8 },
    body: { src: 'noise', mode: 'bp', f: 1000, q: 0.7, a: 0.0008, dur: 0.22 },
    boom: { src: 'sine', f: 68, f1: 30, sweep: 0.26, a: 0.0015, dur: 0.32, g: 1.3, partials: [[1, 1, 1], [2, 0.35, 0.6]] },
    tail: { src: 'noise', mode: 'lp', f: 1400, f1: 180, glide: 0.3, a: 0.01, d: 0.24, g: 0.42 },
    cylinder: { src: 'noise', mode: 'bp', f: 2800, q: 4, at: 0.3, a: 0.0005, d: 0.006, g: 0.12 },
  } },
  icon: { w: 26, h: 16, d: 'M2 5 L4 2 H6 V3 H24 V2 H25.5 V5.5 H17.5 V8 L16 10.5 H11.5 L10 9 H9.5 L8.5 15.5 H3.5 L4 10 L2 8 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
