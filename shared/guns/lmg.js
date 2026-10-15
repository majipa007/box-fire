// Piledriver: a 75-round belt to hold a lane with. Slow to carry, slower
// while it fires, long to reload, and its recoil keeps climbing.
// Fields: docs/guns.md.
export default {
  id: 'lmg', name: 'Piledriver', slot: 'primary', class: 'lmg',
  dmg: 25, head: 2.5, rps: 9.5, mode: 'auto', mag: 75, reload: 4.5,
  spreadStand: 0.25, spreadMove: 4.5, falloff: { from: 20, to: 35, min: 0.7 }, bloom: 0.15, bloomMax: 1.5, kick: [0.4, 0.15], speed: 0.88, fireSpeed: 0.6,
  look: null, sound: null, icon: null,
};
