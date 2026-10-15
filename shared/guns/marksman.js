// Plumb: semi-auto, no scope. Two body hits kill at any range, a headshot
// always does; stand still to shoot it. Fields: docs/guns.md.
export default {
  id: 'marksman', name: 'Plumb', slot: 'primary', class: 'marksman',
  dmg: 55, head: 2.5, rps: 2.75, mode: 'semi', mag: 10, reload: 2.4,
  spreadStand: 0.05, spreadMove: 3, kick: [2.2, 0], speed: 0.95,
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: { w: 52, h: 16, d: 'M1 4 L12 3.5 V3 H32 V5 H51 V6.8 H32 V8.5 H25 V12 H21.5 V8.5 H18 L16.5 13.5 H13.5 L14.5 8.5 H12 L1 10 Z M47 3.5 H48.5 V5.5 H47 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
