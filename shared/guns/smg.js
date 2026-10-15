// Grinder: very fast, light, and as accurate on the move as standing; the
// damage falls away past 10 m. Fields: docs/guns.md.
export default {
  id: 'smg', name: 'Grinder', slot: 'primary', class: 'smg',
  dmg: 20, head: 2.5, rps: 15, mode: 'auto', mag: 30, reload: 2.1,
  spreadStand: 0.6, spreadMove: 1.1, falloff: { from: 10, to: 22, min: 0.6 }, bloom: 0.1, bloomMax: 1.2, kick: [0.15, 0.06],
  look: null, sound: null, icon: null,
};
