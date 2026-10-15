// Rivet: the launch sidearm. Fields: docs/guns.md.
export default {
  id: 'pistol', name: 'Rivet', slot: 'secondary', class: 'pistol',
  dmg: 26, head: 3, rps: 6.75, mode: 'semi', mag: 12, reload: 1.75,
  spreadStand: 0.3, spreadMove: 1.5, falloff: { from: 25, to: 40, min: 0.75 }, kick: [0.9, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: { w: 24, h: 16, d: 'M2 3 H22.5 V8 H10.5 L10 9.5 H9.5 L8 15 H3 L4.5 8 H2 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
