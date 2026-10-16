// Ratchet: three rounds a click, tight and steady, for the mid range where
// the Mason's spray blooms off target. rps is the sustained rate the burst
// numbers give: count / (count / burst.rps + delay). Fields: docs/guns.md.
export default {
  id: 'burst', name: 'Ratchet', slot: 'primary', class: 'burst',
  dmg: 26, head: 3, rps: 8.57, mode: 'burst', burst: { count: 3, rps: 20, delay: 0.2 }, mag: 21, reload: 2.4,
  spreadStand: 0.08, spreadMove: 3, falloff: { from: 22, to: 40, min: 0.7 }, bloom: 0.1, bloomMax: 0.8, kick: [0.35, 0.1],
  look: { // models: a bullpup, the magazine behind the grip, a carry-handle optic. Gun space as in rifle.js
    muzzle: [0, 0.08, -0.52], port: [0.035, 0.085, 0.16], fore: [0, 0.075, -0.24], mag: [0, 0.03, 0.14],
    parts: [
      { c: 'tan', s: [0.066, 0.1, 0.46], at: [0, 0.055, 0.1], tp: 'body' }, // polymer shell, the stock in one
      { c: 'dark', s: [0.07, 0.112, 0.02], at: [0, 0.055, 0.34], tp: 'body' }, // butt pad
      { c: 'dark', s: [0.068, 0.02, 0.1], at: [0, 0.03, 0.22] }, // cheek seam
      { c: 'slot', s: [0.068, 0.012, 0.07], at: [0, 0.085, 0.24] }, // slot stripe
      { c: 'metal', s: [0.05, 0.03, 0.36], at: [0, 0.12, 0.02], tp: 'top' }, // upper receiver
      { c: 'dark', s: [0.046, 0.05, 0.15], at: [0, 0.165, 0.0], tp: 'top' }, // carry-handle optic
      { c: 'dark', s: [0.036, 0.036, 0.02], at: [0, 0.168, 0.085] }, // eyepiece
      { c: 'slot', s: [0.03, 0.03, 0.004], at: [0, 0.168, 0.096] }, // its glass, lit in your colour
      { c: 'metal', s: [0.03, 0.02, 0.03], at: [0, 0.14, -0.05] }, // optic legs
      { c: 'metal', s: [0.03, 0.02, 0.03], at: [0, 0.14, 0.05] },
      { c: 'metal', s: [0.03, 0.016, 0.03], at: [0.036, 0.12, -0.08] }, // charging handle
      { c: 'dark', s: [0.056, 0.064, 0.2], at: [0, 0.075, -0.23], tp: 'barrel' }, // handguard
      { c: 'dark', s: [0.03, 0.01, 0.17], at: [0, 0.112, -0.23] }, // handguard rail
      { c: 'metal', s: [0.025, 0.025, 0.16], at: [0, 0.08, -0.4], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.034, 0.034, 0.04], at: [0, 0.08, -0.5], hot: true, tp: 'barrel' }, // flash hider
      { c: 'dark', s: [0.035, 0.09, 0.05], at: [0, -0.005, 0.01], r: [-0.2618, 0, 0] }, // grip
      { c: 'dark', s: [0.012, 0.012, 0.12], at: [0, -0.005, -0.07] }, // long trigger guard
      { c: 'metal', s: [0.05, 0.016, 0.075], at: [0, 0.01, 0.14] }, // magazine well lip
      { bone: 'mag', c: 'metal', s: [0.042, 0.08, 0.065], at: [0, -0.02, 0.14], r: [0.1, 0, 0], tp: 'mag' }, // curved magazine
      { bone: 'mag', c: 'metal', s: [0.042, 0.07, 0.06], at: [0, -0.085, 0.118], r: [0.35, 0, 0], tp: 'mag' },
      { bone: 'mag', c: 'dark', s: [0.046, 0.012, 0.064], at: [0, -0.118, 0.106], r: [0.35, 0, 0] }, // base plate
    ],
  },
  sound: { level: -8, n: 4, drive: 2.2, slap: true, layers: { // sound: one crisp, tight round; a click fires three (client/audio.js)
    body: { src: 'noise', mode: 'bp', f: 2600, q: 1.4, a: 0.0004, dur: 0.045 },
    snap: { src: 'noise', mode: 'hp', f: 4800, a: 0.0002, dur: 0.01, g: 0.45 },
    thump: { src: 'sine', f: 110, f1: 60, sweep: 0.04, a: 0.0008, dur: 0.05, g: 0.7 },
    tail: { src: 'noise', mode: 'lp', f: 2400, f1: 500, glide: 0.04, a: 0.003, d: 0.025, g: 0.2 },
    ratchet: { src: 'noise', mode: 'bp', f: 3600, q: 4, at: 0.028, a: 0.0003, d: 0.003, g: 0.14 },
  } },
  icon: { w: 48, h: 16, d: 'M1 4 H12 V2 H26 V4 H38 V5.5 H47 V7.5 H38 V9 H30 V10 H22 L21 15 H17.5 L18 10 H11 V14 H6.5 V10 H1 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
