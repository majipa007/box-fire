// Plumb: semi-auto, no scope. Two body hits kill at any range, a headshot
// always does; stand still to shoot it. Fields: docs/guns.md.
export default {
  id: 'marksman', name: 'Plumb', slot: 'primary', class: 'marksman',
  dmg: 55, head: 2.5, rps: 2.75, mode: 'semi', mag: 10, reload: 2.4,
  spreadStand: 0.05, spreadMove: 3, kick: [2.2, 0], speed: 0.95,
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
