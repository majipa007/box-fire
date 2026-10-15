// Mason: the default primary. 4 body hits (300 ms) to about 29 m; every
// headshot a flat 160, mid-spray too. Fields: docs/guns.md.
export default {
  id: 'rifle', name: 'Mason', slot: 'primary', class: 'rifle',
  dmg: 30, head: 3, headDmg: 160, rps: 9.75, mode: 'auto', mag: 25, reload: 2.5,
  spreadStand: 0.15, spreadMove: 2.5, falloff: { from: 20, to: 30, min: 0.8 }, bloom: 0.25, bloomMax: 2, kick: [0.3, 0.12],
  look: null, sound: null, icon: null,
};
