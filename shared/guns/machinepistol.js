// Nailer: a sidearm that sprays. Fast and close, it climbs and blooms hard
// and falls off quickly. Fields: docs/guns.md.
export default {
  id: 'machinepistol', name: 'Nailer', slot: 'secondary', class: 'machinepistol',
  dmg: 18, head: 2.5, rps: 16, mode: 'auto', mag: 18, reload: 1.6,
  spreadStand: 0.9, spreadMove: 1.6, falloff: { from: 6, to: 18, min: 0.5 }, bloom: 0.3, bloomMax: 3, kick: [0.5, 0.18],
  look: { // models: a boxy machine pistol, the long magazine through the grip, a compensator, a tan top cover with a red-dot sight and a top cocking knob. Gun space as in rifle.js
    muzzle: [0, 0.072, -0.23], port: [0.022, 0.08, -0.04], mag: [0, -0.03, 0.012],
    parts: [
      { c: 'metal', s: [0.04, 0.055, 0.2], at: [0, 0.072, -0.055], tp: 'body' }, // receiver
      { c: 'tan', s: [0.036, 0.01, 0.17], at: [0, 0.104, -0.06] }, // top cover, tan: the Nailer's top line from behind
      { c: 'metal', s: [0.014, 0.016, 0.022], at: [0, 0.116, -0.11] }, // cocking knob
      { c: 'dark', s: [0.034, 0.032, 0.044], at: [0, 0.125, -0.005] }, // red-dot sight
      { c: 'metal', s: [0.024, 0.02, 0.004], at: [0, 0.128, 0.018] }, // its glass, glinting the sky
      { c: 'slot', s: [0.042, 0.01, 0.05], at: [0, 0.058, -0.1] }, // slot stripe
      { c: 'dark', s: [0.012, 0.012, 0.03], at: [0.022, 0.08, -0.04] }, // ejection port
      { c: 'metal', s: [0.02, 0.02, 0.05], at: [0, 0.072, -0.175], hot: true, tp: 'barrel' }, // barrel
      { c: 'dark', s: [0.03, 0.03, 0.04], at: [0, 0.072, -0.21], hot: true, tp: 'barrel' }, // compensator
      { c: 'dark', s: [0.032, 0.006, 0.006], at: [0, 0.088, -0.215] }, // its port
      { c: 'dark', s: [0.034, 0.03, 0.11], at: [0, 0.032, -0.05] }, // trigger housing
      { c: 'dark', s: [0.02, 0.04, 0.02], at: [0, 0.028, -0.14], r: [0.2, 0, 0] }, // hand stop
      { c: 'tan', s: [0.036, 0.1, 0.05], at: [0, -0.015, 0.008], r: [-0.12, 0, 0], tp: 'grip' }, // grip
      { c: 'dark', s: [0.008, 0.01, 0.05], at: [0, 0.008, -0.05] }, // trigger guard
      { bone: 'mag', c: 'metal', s: [0.026, 0.19, 0.036], at: [0, -0.05, 0.01], r: [-0.12, 0, 0], tp: 'mag' }, // long magazine
      { bone: 'mag', c: 'tan', s: [0.032, 0.014, 0.044], at: [0, -0.147, 0.022], r: [-0.12, 0, 0] }, // base plate
    ],
  },
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
