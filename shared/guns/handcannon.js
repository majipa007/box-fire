// Sledge: a heavy revolver. Two body hits kill, a headshot always does; it
// kicks hard and fires slowly. Fields: docs/guns.md.
export default {
  id: 'handcannon', name: 'Sledge', slot: 'secondary', class: 'handcannon',
  dmg: 50, head: 3, rps: 2.2, mode: 'semi', mag: 6, reload: 2.25,
  spreadStand: 0.25, spreadMove: 2.5, falloff: { from: 20, to: 40, min: 0.7 }, kick: [3.5, 0],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
