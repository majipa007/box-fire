// Surveyor: right-click to scope. A scoped body hit (150) kills from full
// HP, not through a Shield; the hip cone is wide, the bolt slow, and a
// scoped player walks. rps 4/3 is a 0.75 s bolt. Fields: docs/guns.md.
export default {
  id: 'sniper', name: 'Surveyor', slot: 'primary', class: 'sniper',
  dmg: 150, head: 2, rps: 4 / 3, mode: 'semi', mag: 5, reload: 3,
  spreadStand: 10, spreadMove: 15, kick: [4, 0], speed: 0.9, fireSpeed: 0.7,
  scope: { fov: 30, inSeconds: 0.35, spread: 0.05, moveSpread: 8, speed: 0.55, sens: 0.4 },
  look: null, // models workstream: the box model (docs/guns.md)
  sound: null, // sound workstream: the recipe
  icon: null, // hud workstream: the SVG path
};
