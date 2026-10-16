// Mason: the default primary. 4 body hits (300 ms) to about 29 m; every
// headshot a flat 160, mid-spray too. Fields: docs/guns.md.
export default {
  id: 'rifle', name: 'Mason', slot: 'primary', class: 'rifle',
  dmg: 30, head: 3, headDmg: 160, rps: 9.75, mode: 'auto', mag: 25, reload: 2.5,
  spreadStand: 0.15, spreadMove: 2.5, falloff: { from: 20, to: 30, min: 0.8 }, bloom: 0.25, bloomMax: 2, kick: [0.3, 0.12],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -7, n: 4, drive: 2, slap: true, layers: { // sound: a full crack and the bolt (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 2200, q: 0.9, a: 0.0006, dur: 0.13 },
    thump: { src: 'sine', f: 90, f1: 45, sweep: 0.12, a: 0.001, dur: 0.12, g: 0.9 },
    tail: { src: 'noise', mode: 'lp', f: 2000, f1: 350, glide: 0.12, a: 0.006, d: 0.1, g: 0.3 },
    bolt: { src: 'noise', mode: 'bp', f: 3200, q: 3, at: 0.05, a: 0.0005, d: 0.006, g: 0.15 },
  } },
  icon: { w: 48, h: 16, d: 'M1 4 H10 V3 H13 V1.5 H18 V3 H28 V5 H40 V6 H47 V8 H40 V9 H28 V10 H23 L24.5 15 H20 L18.5 10 H15.5 L16 14 H12.5 L12 10 H10 V12 H1 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
