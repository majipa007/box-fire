// Piledriver: a 75-round belt to hold a lane with. Slow to carry, slower
// while it fires, long to reload, and its recoil keeps climbing.
// Fields: docs/guns.md.
export default {
  id: 'lmg', name: 'Piledriver', slot: 'primary', class: 'lmg',
  dmg: 25, head: 2.5, rps: 9.5, mode: 'auto', mag: 75, reload: 4.5,
  spreadStand: 0.25, spreadMove: 4.5, falloff: { from: 20, to: 35, min: 0.7 }, bloom: 0.15, bloomMax: 1.5, kick: [0.4, 0.15], speed: 0.88, fireSpeed: 0.6,
  look: { // models: a belt-fed machine gun, a feed cover (bone cover, hinged at the front), a hanging ammo box with its belt, a carry handle. Gun space as in rifle.js
    muzzle: [0, 0.08, -0.83], port: [0.04, 0.07, -0.08], fore: [0, 0.06, -0.34], mag: [-0.02, 0.03, -0.13], action: [0, 0.125, -0.165],
    parts: [
      { c: 'metal', s: [0.07, 0.09, 0.34], at: [0, 0.075, -0.07], tp: 'body' }, // receiver
      { c: 'slot', s: [0.072, 0.012, 0.08], at: [0, 0.09, 0.04] }, // slot stripe
      { c: 'brass', s: [0.05, 0.012, 0.04], at: [0, 0.122, -0.09] }, // the belt on the feed tray, seen with the cover up
      { c: 'metal', s: [0.016, 0.016, 0.03], at: [0.04, 0.08, -0.17] }, // charging handle
      { c: 'tan', s: [0.064, 0.055, 0.2], at: [0, 0.058, -0.34], tp: 'body' }, // forend
      { c: 'dark', s: [0.044, 0.022, 0.24], at: [0, 0.1, -0.37] }, // heat shield
      { c: 'metal', s: [0.018, 0.018, 0.2], at: [0, 0.042, -0.52] }, // gas tube
      { c: 'metal', s: [0.034, 0.034, 0.34], at: [0, 0.08, -0.62], hot: true, tp: 'barrel' }, // heavy barrel
      { c: 'dark', s: [0.042, 0.042, 0.05], at: [0, 0.08, -0.805], hot: true, tp: 'barrel' }, // flash hider
      { c: 'dark', s: [0.01, 0.05, 0.014], at: [0, 0.12, -0.76] }, // front sight
      { c: 'dark', s: [0.016, 0.04, 0.016], at: [0, 0.115, -0.42] }, // carry handle
      { c: 'dark', s: [0.016, 0.04, 0.016], at: [0, 0.115, -0.53] },
      { c: 'dark', s: [0.018, 0.014, 0.13], at: [0, 0.14, -0.475] },
      { c: 'dark', s: [0.012, 0.012, 0.22], at: [-0.016, 0.044, -0.66] }, // folded bipod
      { c: 'dark', s: [0.012, 0.012, 0.22], at: [0.016, 0.044, -0.66] },
      { c: 'dark', s: [0.035, 0.09, 0.05], at: [0, -0.005, 0.01], r: [-0.2618, 0, 0] }, // grip
      { c: 'dark', s: [0.012, 0.012, 0.07], at: [0, 0, -0.065] }, // trigger guard
      { c: 'dark', s: [0.03, 0.035, 0.06], at: [0, 0.08, 0.12] }, // buffer
      { c: 'dark', s: [0.05, 0.1, 0.2], at: [0, 0.06, 0.24], tp: 'stock' }, // stock
      { c: 'dark', s: [0.054, 0.106, 0.02], at: [0, 0.06, 0.345], tp: 'stock' }, // butt pad
      { bone: 'cover', c: 'dark', s: [0.066, 0.026, 0.17], at: [0, 0.133, -0.08] }, // feed cover
      { bone: 'cover', c: 'metal', s: [0.068, 0.006, 0.016], at: [0, 0.148, -0.04] }, // its ribs
      { bone: 'cover', c: 'metal', s: [0.068, 0.006, 0.016], at: [0, 0.148, -0.09] },
      { bone: 'cover', c: 'dark', s: [0.03, 0.022, 0.016], at: [0, 0.155, 0.0] }, // rear sight
      { bone: 'mag', c: 'tan', s: [0.075, 0.11, 0.13], at: [-0.02, -0.03, -0.13], tp: 'mag' }, // ammo box
      { bone: 'mag', c: 'dark', s: [0.079, 0.014, 0.134], at: [-0.02, 0.022, -0.13] }, // its lid
      { bone: 'mag', c: 'metal', s: [0.01, 0.03, 0.03], at: [-0.06, -0.02, -0.13] }, // latch
      { bone: 'mag', c: 'brass', s: [0.014, 0.06, 0.034], at: [-0.042, 0.06, -0.09] }, // the belt up the side
      { bone: 'mag', c: 'brass', s: [0.03, 0.012, 0.034], at: [-0.03, 0.094, -0.09] },
    ],
  },
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
