// Crusher: 12 × 10 = 120, so a full blast kills 100 HP but not a Shield's
// 160. Pellets fall from full at 8 m to a fifth at 18 m. Fields: docs/guns.md.
export default {
  id: 'shotgun', name: 'Crusher', slot: 'primary', class: 'shotgun',
  dmg: 10, head: 2, pellets: 12, rps: 1.1, mode: 'semi', mag: 5, reload: 0.5, perShell: true,
  spreadStand: 3.5, spreadMove: 3.5, falloff: { from: 8, to: 18, min: 0.2 }, kick: [2.5, 0],
  look: { // models: the box model, gun space as in rifle.js
    muzzle: [0, 0.09, -0.61], port: [0.035, 0.07, -0.09], fore: [0, 0.05, -0.36], mag: [0, 0.05, -0.36],
    parts: [
      { c: 'metal', s: [0.06, 0.08, 0.2], at: [0, 0.07, -0.08], tp: 'body' }, // receiver
      { c: 'metal', s: [0.035, 0.035, 0.42], at: [0, 0.09, -0.39], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.03, 0.03, 0.36], at: [0, 0.05, -0.36], tp: 'barrel' }, // magazine tube
      { c: 'metal', s: [0.034, 0.034, 0.02], at: [0, 0.05, -0.55] }, // tube cap
      { c: 'dark', s: [0.01, 0.008, 0.4], at: [0, 0.111, -0.39] }, // rib
      { c: 'brass', s: [0.01, 0.01, 0.01], at: [0, 0.12, -0.595], hot: true }, // bead
      { c: 'dark', s: [0.036, 0.1, 0.046], at: [0, -0.005, 0.01], r: [-0.3, 0, 0] }, // grip
      { c: 'dark', s: [0.01, 0.01, 0.06], at: [0, 0.015, -0.05] }, // trigger guard
      { c: 'tan', s: [0.05, 0.09, 0.24], at: [0, 0.05, 0.14], r: [0.1, 0, 0], tp: 'stock' }, // stock
      { c: 'dark', s: [0.054, 0.1, 0.02], at: [0, 0.038, 0.265], r: [0.1, 0, 0], tp: 'stock' }, // butt pad
      { c: 'shell', s: [0.024, 0.06, 0.024], at: [-0.042, 0.07, -0.13] }, // side saddle
      { c: 'shell', s: [0.024, 0.06, 0.024], at: [-0.042, 0.07, -0.1] },
      { c: 'shell', s: [0.024, 0.06, 0.024], at: [-0.042, 0.07, -0.07] },
      { c: 'shell', s: [0.024, 0.06, 0.024], at: [-0.042, 0.07, -0.04] },
      { bone: 'pump', c: 'tan', s: [0.055, 0.055, 0.14], at: [0, 0.05, -0.36], tp: 'pump' }, // pump
      { bone: 'pump', c: 'dark', s: [0.058, 0.008, 0.1], at: [0, 0.034, -0.36] }, // pump grooves
    ],
  },
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
