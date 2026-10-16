// Surveyor: right-click to scope. A scoped body hit (150) kills from full
// HP, not through a Shield; the hip cone is wide, the bolt slow, and a
// scoped player walks. rps 4/3 is a 0.75 s bolt. Fields: docs/guns.md.
export default {
  id: 'sniper', name: 'Surveyor', slot: 'primary', class: 'sniper',
  dmg: 150, head: 2, rps: 4 / 3, mode: 'semi', mag: 5, reload: 3,
  spreadStand: 10, spreadMove: 15, kick: [4, 0], speed: 0.9, fireSpeed: 0.7,
  scope: { fov: 30, inSeconds: 0.35, spread: 0.05, moveSpread: 8, speed: 0.55, sens: 0.4 },
  look: null, // models workstream: the box model (docs/guns.md)
  sound: { level: -4, n: 3, drive: 3, send: 2, slap: true, layers: { // sound: a sharp crack, a long rolling tail, the bolt (client/audio.js)
    crack: { src: 'noise', mode: 'hp', f: 3500, a: 0.0002, dur: 0.025 },
    snap: { src: 'noise', mode: 'bp', f: 5200, q: 0.8, a: 0.0002, dur: 0.012, g: 0.8 },
    body: { src: 'noise', mode: 'bp', f: 1400, q: 0.7, a: 0.0006, dur: 0.2, g: 0.8 },
    boom: { src: 'sine', f: 65, f1: 30, sweep: 0.3, a: 0.0015, dur: 0.35 },
    tail: { src: 'noise', mode: 'lp', f: 1200, f1: 150, glide: 0.6, a: 0.02, d: 0.4, g: 0.45 },
    roll: { src: 'noise', mode: 'lp', f: 600, at: 0.2, a: 0.12, d: 0.35, g: 0.22, am: [3.5, 0.5] },
    boltBack: { src: 'noise', mode: 'bp', f: 1800, q: 2, at: 0.45, a: 0.002, d: 0.02, g: 0.14 },
    boltFwd: { src: 'noise', mode: 'bp', f: 2700, q: 2.5, at: 0.62, a: 0.001, d: 0.014, g: 0.17 },
  } },
  icon: null, // hud workstream: the SVG path
};
