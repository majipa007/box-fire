// Ratchet: three rounds a click, tight and steady, for the mid range where
// the Mason's spray blooms off target. rps is the sustained rate the burst
// numbers give: count / (count / burst.rps + delay). Fields: docs/guns.md.
export default {
  id: 'burst', name: 'Ratchet', slot: 'primary', class: 'burst',
  dmg: 26, head: 3, rps: 7.76, mode: 'burst', burst: { count: 3, rps: 18, delay: 0.22 }, mag: 24, reload: 2.4,
  spreadStand: 0.1, spreadMove: 3, bloom: 0.15, bloomMax: 1, kick: [0.35, 0.1],
  look: null, sound: null, icon: null,
};
