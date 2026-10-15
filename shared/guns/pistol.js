// Rivet: the launch sidearm. Fields: docs/guns.md.
export default {
  id: 'pistol', name: 'Rivet', slot: 'secondary', class: 'pistol',
  dmg: 26, head: 3, rps: 6.75, mode: 'semi', mag: 12, reload: 1.75,
  spreadStand: 0.3, spreadMove: 1.5, falloff: { from: 25, to: 40, min: 0.75 }, kick: [0.9, 0],
  look: { // models: the box model, gun space as in rifle.js
    muzzle: [0, 0.078, -0.17], port: [0.02, 0.085, -0.02], mag: [0, -0.03, 0.015],
    parts: [
      { bone: 'slide', c: 'metal', s: [0.035, 0.04, 0.19], at: [0, 0.075, -0.055], tp: 'body' }, // slide
      { bone: 'slide', c: 'dark', s: [0.037, 0.026, 0.035], at: [0, 0.078, 0.015] }, // serrations
      { bone: 'slide', c: 'dark', s: [0.008, 0.012, 0.012], at: [0, 0.1, -0.138] }, // front sight
      { bone: 'slide', c: 'dark', s: [0.03, 0.012, 0.012], at: [0, 0.1, 0.028] }, // rear sight
      { c: 'dark', s: [0.018, 0.018, 0.012], at: [0, 0.078, -0.153], hot: true }, // barrel
      { c: 'dark', s: [0.03, 0.03, 0.16], at: [0, 0.04, -0.06], tp: 'body' }, // frame
      { c: 'tan', s: [0.032, 0.11, 0.05], at: [0, -0.02, 0.012], r: [-0.2094, 0, 0], tp: 'grip' }, // grip
      { c: 'dark', s: [0.008, 0.01, 0.05], at: [0, 0.01, -0.05] }, // trigger guard
      { bone: 'mag', c: 'tan', s: [0.024, 0.1, 0.038], at: [0, -0.025, 0.014], r: [-0.2094, 0, 0] }, // magazine, inside the grip
      { bone: 'mag', c: 'dark', s: [0.036, 0.012, 0.055], at: [0, -0.078, 0.024], r: [-0.2094, 0, 0] }, // base plate
    ],
  },
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
