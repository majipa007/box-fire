// Ratchet: three rounds a click, tight and steady, for the mid range where
// the Mason's spray blooms off target. rps is the sustained rate the burst
// numbers give: count / (count / burst.rps + delay). Fields: docs/guns.md.
export default {
  id: 'burst', name: 'Ratchet', slot: 'primary', class: 'burst',
  dmg: 26, head: 3, rps: 8.57, mode: 'burst', burst: { count: 3, rps: 20, delay: 0.2 }, mag: 21, reload: 2.4,
  spreadStand: 0.08, spreadMove: 3, falloff: { from: 22, to: 40, min: 0.7 }, bloom: 0.1, bloomMax: 0.8, kick: [0.35, 0.1],
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
