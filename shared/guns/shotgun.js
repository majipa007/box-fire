// Crusher: 12 × 10 = 120, so a full blast kills 100 HP but not a Shield's
// 160. Pellets fall from full at 8 m to a fifth at 18 m. Fields: docs/guns.md.
export default {
  id: 'shotgun', name: 'Crusher', slot: 'primary', class: 'shotgun',
  dmg: 10, head: 2, pellets: 12, rps: 1.1, mode: 'semi', mag: 5, reload: 0.5, perShell: true,
  spreadStand: 3.5, spreadMove: 3.5, falloff: { from: 8, to: 18, min: 0.2 }, kick: [2.5, 0],
  look: null, sound: null, icon: null,
};
