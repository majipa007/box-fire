// Grinder: very fast, light, and as accurate on the move as standing; the
// damage falls away past 10 m. Fields: docs/guns.md.
export default {
  id: 'smg', name: 'Grinder', slot: 'primary', class: 'smg',
  dmg: 20, head: 2.5, rps: 15, mode: 'auto', mag: 30, reload: 2.1,
  spreadStand: 0.6, spreadMove: 1.1, falloff: { from: 10, to: 22, min: 0.6 }, bloom: 0.1, bloomMax: 1.2, kick: [0.15, 0.06],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: { w: 40, h: 16, d: 'M1 4 H9 V3 H29 V5 H39 V7.5 H29 V9 H21 V15.5 H17 V9 H14.5 L13 14.5 H9.5 L11 9 H5 V7 H1 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
