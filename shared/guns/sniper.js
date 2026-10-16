// Surveyor: right-click to scope. A scoped body hit (150) kills from full
// HP, not through a Shield; the hip cone is wide, the bolt slow, and a
// scoped player walks. rps 4/3 is a 0.75 s bolt. Fields: docs/guns.md.
export default {
  id: 'sniper', name: 'Surveyor', slot: 'primary', class: 'sniper',
  dmg: 150, head: 2, rps: 4 / 3, mode: 'semi', mag: 5, reload: 3,
  spreadStand: 10, spreadMove: 15, kick: [4, 0], speed: 0.9, fireSpeed: 0.7,
  scope: { fov: 30, inSeconds: 0.35, spread: 0.05, moveSpread: 8, speed: 0.55, sens: 0.4 },
  look: { // models: a bolt-action rifle, a long scope, a turn-bolt (bone bolt) and a short box magazine. Gun space as in rifle.js
    muzzle: [0, 0.085, -1.005], port: [0.03, 0.09, 0.0], fore: [0, 0.05, -0.33], mag: [0, 0.045, -0.1], action: [0, 0.085, 0.06],
    parts: [
      { c: 'metal', s: [0.05, 0.06, 0.24], at: [0, 0.08, -0.06], tp: 'body' }, // receiver
      { c: 'tan', s: [0.058, 0.062, 0.36], at: [0, 0.05, -0.34], tp: 'body' }, // forend
      { c: 'slot', s: [0.06, 0.01, 0.06], at: [0, 0.06, -0.22] }, // slot stripe
      { c: 'metal', s: [0.026, 0.026, 0.46], at: [0, 0.085, -0.72], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.042, 0.034, 0.06], at: [0, 0.085, -0.975], hot: true, tp: 'barrel' }, // muzzle brake
      { c: 'dark', s: [0.044, 0.008, 0.012], at: [0, 0.085, -0.965] }, // its ports
      { c: 'dark', s: [0.04, 0.04, 0.3], at: [0, 0.15, -0.06], tp: 'top' }, // scope tube
      { c: 'dark', s: [0.058, 0.058, 0.07], at: [0, 0.155, -0.245], tp: 'top' }, // objective bell
      { c: 'dark', s: [0.05, 0.05, 0.055], at: [0, 0.152, 0.11] }, // eyepiece
      { c: 'metal', s: [0.04, 0.04, 0.004], at: [0, 0.152, 0.139] }, // its glass, glinting the sky
      { c: 'metal', s: [0.022, 0.026, 0.026], at: [0, 0.182, -0.07] }, // elevation turret
      { c: 'metal', s: [0.026, 0.022, 0.026], at: [0.031, 0.15, -0.07] }, // windage turret
      { c: 'metal', s: [0.05, 0.03, 0.024], at: [0, 0.118, -0.14], tp: 'top' }, // rings: in third person they join the scope to the receiver
      { c: 'metal', s: [0.05, 0.03, 0.024], at: [0, 0.118, 0.02], tp: 'top' },
      { c: 'dark', s: [0.03, 0.02, 0.03], at: [0, 0.01, -0.48] }, // bipod mount
      { c: 'dark', s: [0.012, 0.012, 0.2], at: [-0.017, 0.012, -0.37] }, // folded bipod
      { c: 'dark', s: [0.012, 0.012, 0.2], at: [0.017, 0.012, -0.37] },
      { c: 'tan', s: [0.038, 0.095, 0.05], at: [0, -0.005, 0.014], r: [-0.3, 0, 0] }, // grip
      { c: 'dark', s: [0.01, 0.01, 0.06], at: [0, 0.008, -0.05] }, // trigger guard
      { c: 'tan', s: [0.05, 0.1, 0.28], at: [0, 0.055, 0.24], tp: 'stock' }, // stock, up to the bolt shroud
      { c: 'dark', s: [0.042, 0.026, 0.14], at: [0, 0.117, 0.22] }, // cheek riser
      { c: 'dark', s: [0.054, 0.118, 0.02], at: [0, 0.05, 0.39], tp: 'stock' }, // butt pad
      { bone: 'bolt', c: 'dark', s: [0.034, 0.034, 0.04], at: [0, 0.085, 0.08], tp: 'body' }, // bolt shroud
      { bone: 'bolt', c: 'metal', s: [0.044, 0.01, 0.012], at: [0.036, 0.082, 0.062], r: [0, 0, -0.35] }, // bolt handle
      { bone: 'bolt', c: 'dark', s: [0.022, 0.022, 0.022], at: [0.058, 0.074, 0.062] }, // its knob
      { bone: 'mag', c: 'metal', s: [0.04, 0.05, 0.08], at: [0, 0.03, -0.1] }, // box magazine
      { bone: 'mag', c: 'dark', s: [0.044, 0.012, 0.084], at: [0, 0.003, -0.1] }, // base plate
    ],
  },
  sound: { level: -4, n: 3, drive: 3, send: 2, slap: true, layers: { // sound: a sharp crack, a long rolling tail, the bolt (client/audio.js)
    crack: { src: 'noise', mode: 'hp', f: 3500, a: 0.0002, dur: 0.025 },
    snap: { src: 'noise', mode: 'bp', f: 5200, q: 0.8, a: 0.0002, dur: 0.012, g: 0.8 },
    body: { src: 'noise', mode: 'bp', f: 1400, q: 0.7, a: 0.0006, dur: 0.2, g: 0.8 },
    boom: { src: 'sine', f: 65, f1: 30, sweep: 0.3, a: 0.0015, dur: 0.35 },
    tail: { src: 'noise', mode: 'lp', f: 1200, f1: 150, glide: 0.6, a: 0.02, d: 0.4, g: 0.45 },
    roll: { src: 'noise', mode: 'lp', f: 600, at: 0.2, a: 0.12, d: 0.35, g: 0.22, am: [3.5, 0.5] },
    boltBack: { src: 'noise', mode: 'bp', f: 1800, q: 2, at: 0.45, a: 0.002, d: 0.02, g: 0.14 },
    boltFwd: { src: 'noise', mode: 'bp', f: 2700, q: 2.5, at: 0.62, a: 0.001, d: 0.014, g: 0.17 },
  } },
  icon: { w: 56, h: 16, d: 'M1 5 L14 5.5 V6 H32 V6.8 H52 V6 H55 V9 H52 V8.3 H32 V9.5 H26 V12 H22.5 V9.5 H20 L18.5 14 H15.5 L16.5 9.5 H14 L1 12 Z M14 1.5 H18 V2.5 H28 V1 H34 V5 H28 V4.5 H27.5 V6.5 H26 V4.5 H21 V6.5 H19.5 V4.5 H18 V5 H14 Z M29.5 9 H31 L32.5 11.8 H30.8 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
