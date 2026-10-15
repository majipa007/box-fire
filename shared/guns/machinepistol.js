// Nailer: a sidearm that sprays. Fast and close, it climbs and blooms hard
// and falls off quickly. Fields: docs/guns.md.
export default {
  id: 'machinepistol', name: 'Nailer', slot: 'secondary', class: 'machinepistol',
  dmg: 18, head: 2.5, rps: 16, mode: 'auto', mag: 18, reload: 1.6,
  spreadStand: 0.9, spreadMove: 1.6, falloff: { from: 6, to: 18, min: 0.5 }, bloom: 0.3, bloomMax: 3, kick: [0.5, 0.18],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: { w: 24, h: 16, d: 'M1 3 H20 V4 H23 V7 H20 V8 H10.5 L10 9.5 H9.5 V15.5 H5.5 V9.5 H4 L4.5 8 H1 Z M14 7.5 H16.5 V12.5 H14 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
