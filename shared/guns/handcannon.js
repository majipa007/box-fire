// Sledge: a heavy revolver. Two body hits kill, a headshot always does; it
// kicks hard and fires slowly. Fields: docs/guns.md.
export default {
  id: 'handcannon', name: 'Sledge', slot: 'secondary', class: 'handcannon',
  dmg: 50, head: 3, rps: 2.2, mode: 'semi', mag: 6, reload: 2.25,
  spreadStand: 0.25, spreadMove: 2.5, falloff: { from: 20, to: 40, min: 0.7 }, kick: [3.5, 0],
  look: { // models: a heavy revolver, full underlug, fluted cylinder on a crane (the mag bone) that swings out left. Gun space as in rifle.js
    muzzle: [0, 0.078, -0.215], mag: [-0.02, 0.043, -0.05],
    parts: [
      { c: 'metal', s: [0.03, 0.014, 0.1], at: [0, 0.104, -0.025], tp: 'body' }, // top strap
      { c: 'metal', s: [0.032, 0.03, 0.1], at: [0, 0.03, -0.02], tp: 'body' }, // lower frame
      { c: 'metal', s: [0.036, 0.075, 0.022], at: [0, 0.062, 0.032], tp: 'body' }, // recoil shield
      { c: 'dark', s: [0.012, 0.03, 0.018], at: [0, 0.102, 0.048], r: [-0.5, 0, 0] }, // hammer
      { c: 'dark', s: [0.022, 0.012, 0.012], at: [0, 0.117, 0.016] }, // rear sight
      { c: 'metal', s: [0.028, 0.028, 0.16], at: [0, 0.078, -0.135], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.022, 0.026, 0.155], at: [0, 0.052, -0.128], tp: 'barrel' }, // underlug
      { c: 'dark', s: [0.012, 0.01, 0.17], at: [0, 0.096, -0.125] }, // vent rib
      { c: 'dark', s: [0.007, 0.022, 0.018], at: [0, 0.108, -0.2] }, // front ramp
      { c: 'shell', s: [0.008, 0.008, 0.008], at: [0, 0.118, -0.196] }, // its red insert
      { c: 'dark', s: [0.03, 0.03, 0.006], at: [0, 0.078, -0.216], hot: true }, // crown
      { c: 'tan', s: [0.036, 0.11, 0.052], at: [0, -0.022, 0.024], r: [-0.3, 0, 0], tp: 'grip' }, // wood grip
      { c: 'metal', s: [0.038, 0.012, 0.056], at: [0, -0.075, 0.042], r: [-0.3, 0, 0] }, // butt cap
      { c: 'dark', s: [0.008, 0.01, 0.05], at: [0, 0.005, -0.045] }, // trigger guard
      { bone: 'mag', c: 'metal', s: [0.05, 0.05, 0.062], at: [0, 0.068, -0.02], tp: 'body' }, // cylinder
      { bone: 'mag', c: 'dark', s: [0.054, 0.01, 0.046], at: [0, 0.068, -0.02] }, // flutes
      { bone: 'mag', c: 'dark', s: [0.01, 0.054, 0.046], at: [0, 0.068, -0.02] },
      { bone: 'mag', c: 'brass', s: [0.034, 0.034, 0.004], at: [0, 0.068, 0.012] }, // case heads in the chambers
      { bone: 'mag', c: 'metal', s: [0.008, 0.008, 0.06], at: [0, 0.042, -0.07] }, // ejector rod
    ],
  },
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
