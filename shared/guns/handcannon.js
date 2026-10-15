// Sledge: a heavy revolver. Two body hits kill, a headshot always does; it
// kicks hard and fires slowly. Fields: docs/guns.md.
export default {
  id: 'handcannon', name: 'Sledge', slot: 'secondary', class: 'handcannon',
  dmg: 50, head: 3, rps: 2.2, mode: 'semi', mag: 6, reload: 2.25,
  spreadStand: 0.25, spreadMove: 2.5, falloff: { from: 20, to: 40, min: 0.7 }, kick: [3.5, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: { w: 26, h: 16, d: 'M2 5 L4 2 H6 V3 H24 V2 H25.5 V5.5 H17.5 V8 L16 10.5 H11.5 L10 9 H9.5 L8.5 15.5 H3.5 L4 10 L2 8 Z' }, // hud workstream: the kill-feed silhouette, facing right
};
