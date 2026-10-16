// Nailer: a sidearm that sprays. Fast and close, it climbs and blooms hard
// and falls off quickly. Fields: docs/guns.md.
export default {
  id: 'machinepistol', name: 'Nailer', slot: 'secondary', class: 'machinepistol',
  dmg: 18, head: 2.5, rps: 16, mode: 'auto', mag: 18, reload: 1.6,
  spreadStand: 0.9, spreadMove: 1.6, falloff: { from: 6, to: 18, min: 0.5 }, bloom: 0.3, bloomMax: 3, kick: [0.5, 0.18],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
