// Grinder: very fast, light, and as accurate on the move as standing; the
// damage falls away past 10 m. Fields: docs/guns.md.
export default {
  id: 'smg', name: 'Grinder', slot: 'primary', class: 'smg',
  dmg: 20, head: 2.5, rps: 15, mode: 'auto', mag: 30, reload: 2.1,
  spreadStand: 0.6, spreadMove: 1.1, falloff: { from: 10, to: 22, min: 0.6 }, bloom: 0.1, bloomMax: 1.2, kick: [0.15, 0.06],
  look: { // models: a stubby boxy SMG, vertical foregrip, long straight magazine, rod stock, red dot. Gun space as in rifle.js
    muzzle: [0, 0.075, -0.4], port: [0.03, 0.085, -0.06], fore: [0, 0.07, -0.27], mag: [0, 0.03, -0.145],
    parts: [
      { c: 'metal', s: [0.056, 0.075, 0.28], at: [0, 0.075, -0.07], tp: 'body' }, // receiver
      { c: 'dark', s: [0.05, 0.032, 0.15], at: [0, 0.024, -0.04] }, // trigger housing
      { c: 'dark', s: [0.032, 0.012, 0.26], at: [0, 0.118, -0.09] }, // top rail
      { c: 'dark', s: [0.042, 0.042, 0.065], at: [0, 0.145, -0.03] }, // red dot housing
      { c: 'slot', s: [0.028, 0.026, 0.004], at: [0, 0.148, 0.003] }, // its lens, lit in your colour
      { c: 'dark', s: [0.03, 0.012, 0.03], at: [0, 0.172, -0.04] }, // turret
      { c: 'slot', s: [0.058, 0.01, 0.06], at: [0, 0.1, -0.14] }, // slot stripe
      { c: 'metal', s: [0.03, 0.016, 0.02], at: [-0.036, 0.09, -0.17] }, // charging knob
      { c: 'tan', s: [0.054, 0.062, 0.13], at: [0, 0.07, -0.275], tp: 'body' }, // shroud
      { c: 'dark', s: [0.056, 0.012, 0.022], at: [0, 0.085, -0.245] }, // shroud vents
      { c: 'dark', s: [0.056, 0.012, 0.022], at: [0, 0.085, -0.28] },
      { c: 'dark', s: [0.056, 0.012, 0.022], at: [0, 0.085, -0.315] },
      { c: 'dark', s: [0.03, 0.03, 0.065], at: [0, 0.075, -0.37], hot: true, tp: 'body' }, // muzzle
      { c: 'dark', s: [0.034, 0.1, 0.04], at: [0, -0.01, -0.27], r: [0.08, 0, 0], tp: 'fore' }, // vertical foregrip
      { c: 'dark', s: [0.035, 0.09, 0.05], at: [0, -0.005, 0.01], r: [-0.2618, 0, 0] }, // grip
      { c: 'dark', s: [0.01, 0.01, 0.06], at: [0, 0, -0.065] }, // trigger guard
      { c: 'metal', s: [0.042, 0.03, 0.058], at: [0, 0.025, -0.145] }, // magazine well
      { c: 'metal', s: [0.05, 0.05, 0.04], at: [0, 0.08, 0.09], tp: 'stock' }, // stock block
      { c: 'dark', s: [0.01, 0.01, 0.19], at: [-0.018, 0.09, 0.2], tp: 'stock' }, // stock rods
      { c: 'dark', s: [0.01, 0.01, 0.19], at: [0.018, 0.09, 0.2] },
      { c: 'dark', s: [0.05, 0.085, 0.02], at: [0, 0.075, 0.3], tp: 'stock' }, // butt plate
      { bone: 'mag', c: 'metal', s: [0.03, 0.17, 0.05], at: [0, -0.06, -0.148], r: [0.06, 0, 0], tp: 'mag' }, // long straight magazine
      { bone: 'mag', c: 'tan', s: [0.034, 0.016, 0.056], at: [0, -0.146, -0.153], r: [0.06, 0, 0], tp: 'mag' }, // base pad
    ],
  },
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
