// Piledriver: a 75-round belt to hold a lane with. Slow to carry, slower
// while it fires, long to reload, and its recoil keeps climbing.
// Fields: docs/guns.md.
export default {
  id: 'lmg', name: 'Piledriver', slot: 'primary', class: 'lmg',
  dmg: 26, head: 2.5, rps: 10, mode: 'auto', mag: 75, reload: 4.5,
  spreadStand: 0.3, spreadMove: 4.5, falloff: { from: 25, to: 45, min: 0.8 }, bloom: 0.35, bloomMax: 3, kick: [0.4, 0.15], speed: 0.88, fireSpeed: 0.6,
  look: null, sound: null, icon: null,
};
