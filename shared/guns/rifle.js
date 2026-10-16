// Mason: the default primary. 4 body hits (300 ms) to about 29 m; every
// headshot a flat 160, mid-spray too. Fields: docs/guns.md.
export default {
  id: 'rifle', name: 'Mason', slot: 'primary', class: 'rifle',
  dmg: 30, head: 3, headDmg: 160, rps: 9.75, mode: 'auto', mag: 25, reload: 2.5,
  spreadStand: 0.15, spreadMove: 2.5, falloff: { from: 20, to: 30, min: 0.8 }, bloom: 0.25, bloomMax: 2, kick: [0.3, 0.12],
  look: { // models: the box model, gun space: origin at the right hand on the grip, x right, y up, -z ahead; metres, radians
    muzzle: [0, 0.075, -0.765], port: [0.035, 0.085, -0.03], fore: [0, 0.075, -0.36], mag: [0, 0.03, -0.15],
    parts: [ // c: colour key, s: size, at: centre, r: rotation; bone: mag/pump/slide/bolt/cover, else the body; hot: glows when fired; tp: third-person group
      { c: 'metal', s: [0.06, 0.08, 0.36], at: [0, 0.075, -0.07], tp: 'body' }, // receiver
      { c: 'dark', s: [0.034, 0.012, 0.3], at: [0, 0.121, -0.08] }, // top rail
      { c: 'dark', s: [0.034, 0.03, 0.04], at: [0, 0.142, 0.06] }, // rear sight
      { c: 'dark', s: [0.012, 0.05, 0.02], at: [0, 0.13, -0.44] }, // front sight
      { c: 'metal', s: [0.04, 0.012, 0.03], at: [0, 0.121, 0.11] }, // charging handle
      { c: 'slot', s: [0.062, 0.01, 0.08], at: [0, 0.1, -0.17] }, // slot stripe
      { c: 'metal', s: [0.064, 0.03, 0.08], at: [0, 0.03, -0.15], tp: 'mag' }, // magazine well: in third person it seats the magazine
      { c: 'dark', s: [0.035, 0.09, 0.05], at: [0, -0.005, 0.01], r: [-0.2618, 0, 0] }, // grip
      { c: 'dark', s: [0.01, 0.01, 0.07], at: [0, 0, -0.065] }, // trigger guard
      { c: 'tan', s: [0.055, 0.06, 0.22], at: [0, 0.075, -0.36], tp: 'body' }, // handguard
      { c: 'dark', s: [0.03, 0.01, 0.2], at: [0, 0.11, -0.36] }, // handguard rail
      { c: 'dark', s: [0.035, 0.04, 0.03], at: [0, 0.075, -0.49], hot: true }, // gas block
      { c: 'metal', s: [0.025, 0.025, 0.3], at: [0, 0.075, -0.58], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.035, 0.035, 0.035], at: [0, 0.075, -0.745], hot: true, tp: 'barrel' }, // brake
      { c: 'dark', s: [0.03, 0.035, 0.1], at: [0, 0.085, 0.16], tp: 'stock' }, // buffer tube
      { c: 'dark', s: [0.05, 0.08, 0.2], at: [0, 0.065, 0.26], tp: 'stock' }, // stock
      { c: 'dark', s: [0.054, 0.086, 0.02], at: [0, 0.065, 0.37], tp: 'stock' }, // butt pad
      { bone: 'mag', c: 'tan', s: [0.045, 0.08, 0.07], at: [0, -0.02, -0.15], r: [0.1, 0, 0], tp: 'mag' }, // curved magazine, polymer
      { bone: 'mag', c: 'tan', s: [0.045, 0.07, 0.065], at: [0, -0.085, -0.172], r: [0.35, 0, 0], tp: 'mag' },
    ],
  },
  sound: { level: -7, n: 4, drive: 2, slap: true, layers: { // sound: a full crack and the bolt (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 2200, q: 0.9, a: 0.0006, dur: 0.13 },
    thump: { src: 'sine', f: 90, f1: 45, sweep: 0.12, a: 0.001, dur: 0.12, g: 0.9 },
    tail: { src: 'noise', mode: 'lp', f: 2000, f1: 350, glide: 0.12, a: 0.006, d: 0.1, g: 0.3 },
    bolt: { src: 'noise', mode: 'bp', f: 3200, q: 3, at: 0.05, a: 0.0005, d: 0.006, g: 0.15 },
  } },
  icon: { w: 48, h: 16, d: 'M1 4 H10 V3 H13 V1.5 H18 V3 H28 V5 H40 V6 H47 V8 H40 V9 H28 V10 H23 L24.5 15 H20 L18.5 10 H15.5 L16 14 H12.5 L12 10 H10 V12 H1 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
