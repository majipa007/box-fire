// Rivet: the launch sidearm. Fields: docs/guns.md.
export default {
  id: 'pistol', name: 'Rivet', slot: 'secondary', class: 'pistol',
  dmg: 26, head: 3, rps: 6.75, mode: 'semi', mag: 12, reload: 1.75,
  spreadStand: 0.3, spreadMove: 1.5, falloff: { from: 25, to: 40, min: 0.75 }, kick: [0.9, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
