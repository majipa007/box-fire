// Plumb: semi-auto, no scope. Two body hits kill at any range, a headshot
// always does; stand still to shoot it. Fields: docs/guns.md.
export default {
  id: 'marksman', name: 'Plumb', slot: 'primary', class: 'marksman',
  dmg: 55, head: 2.5, rps: 2.75, mode: 'semi', mag: 10, reload: 2.4,
  spreadStand: 0.05, spreadMove: 3, kick: [2.2, 0], speed: 0.95,
  look: { // models: a battle rifle, a long tan stock to the front band, a straight ten-round box. Gun space as in rifle.js
    muzzle: [0, 0.09, -0.8], port: [0.03, 0.11, -0.05], fore: [0, 0.055, -0.33], mag: [0, 0.045, -0.12],
    parts: [
      { c: 'tan', s: [0.056, 0.056, 0.36], at: [0, 0.055, -0.28], tp: 'body' }, // forend
      { c: 'metal', s: [0.05, 0.06, 0.25], at: [0, 0.09, -0.055], tp: 'body' }, // receiver
      { c: 'dark', s: [0.036, 0.022, 0.22], at: [0, 0.097, -0.3] }, // upper handguard
      { c: 'slot', s: [0.058, 0.01, 0.07], at: [0, 0.06, -0.22] }, // slot stripe
      { c: 'metal', s: [0.026, 0.016, 0.016], at: [0.036, 0.1, -0.13] }, // charging knob
      { c: 'dark', s: [0.012, 0.022, 0.12], at: [0.03, 0.085, -0.2] }, // op rod
      { c: 'dark', s: [0.04, 0.04, 0.04], at: [0, 0.075, -0.465] }, // front band
      { c: 'metal', s: [0.018, 0.018, 0.12], at: [0, 0.062, -0.52] }, // gas cylinder
      { c: 'metal', s: [0.022, 0.022, 0.3], at: [0, 0.09, -0.6], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.034, 0.034, 0.06], at: [0, 0.09, -0.77], hot: true, tp: 'barrel' }, // flash suppressor
      { c: 'dark', s: [0.008, 0.04, 0.012], at: [0, 0.122, -0.76] }, // front sight post
      { c: 'dark', s: [0.006, 0.03, 0.012], at: [-0.012, 0.118, -0.76] }, // its ears
      { c: 'dark', s: [0.006, 0.03, 0.012], at: [0.012, 0.118, -0.76] },
      { c: 'dark', s: [0.036, 0.036, 0.022], at: [0, 0.135, 0.03] }, // rear aperture
      { c: 'tan', s: [0.044, 0.095, 0.08], at: [0, 0.0, 0.03], r: [-0.35, 0, 0], tp: 'stock' }, // wrist
      { c: 'tan', s: [0.05, 0.1, 0.24], at: [0, 0.045, 0.21], r: [0.05, 0, 0], tp: 'stock' }, // butt
      { c: 'metal', s: [0.052, 0.112, 0.016], at: [0, 0.04, 0.335], r: [0.05, 0, 0], tp: 'stock' }, // butt plate
      { c: 'dark', s: [0.01, 0.01, 0.06], at: [0, -0.01, -0.055] }, // trigger guard
      { bone: 'mag', c: 'metal', s: [0.036, 0.09, 0.07], at: [0, 0.0, -0.12], r: [0.05, 0, 0], tp: 'mag' }, // straight ten-round box
      { bone: 'mag', c: 'dark', s: [0.04, 0.012, 0.076], at: [0, -0.048, -0.122], r: [0.05, 0, 0] }, // base plate
    ],
  },
  sound: { level: -6, n: 4, drive: 2.4, send: 1.4, slap: true, layers: { // sound: a hard crack and a rolling tail (client/audio.js)
    crack: { src: 'noise', mode: 'hp', f: 3200, a: 0.0002, dur: 0.02, g: 0.7 },
    body: { src: 'noise', mode: 'bp', f: 1900, q: 0.9, a: 0.0005, dur: 0.16 },
    thump: { src: 'sine', f: 85, f1: 40, sweep: 0.14, a: 0.001, dur: 0.16, g: 0.95 },
    tail: { src: 'noise', mode: 'lp', f: 1700, f1: 280, glide: 0.25, a: 0.01, d: 0.2, g: 0.36 },
    action: { src: 'noise', mode: 'bp', f: 3000, q: 3, at: 0.09, a: 0.0005, d: 0.006, g: 0.13 },
  } },
  icon: { w: 52, h: 16, d: 'M1 4 L12 3.5 V3 H32 V5 H51 V6.8 H32 V8.5 H25 V12 H21.5 V8.5 H18 L16.5 13.5 H13.5 L14.5 8.5 H12 L1 10 Z M47 3.5 H48.5 V5.5 H47 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
