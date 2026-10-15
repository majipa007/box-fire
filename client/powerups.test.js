// The own-Shunt ghost (docs/bible.md §4.4) against a real Game, on one fake
// clock with a LAN link: the rocket drawn after Q never vanishes, stalls or
// slides back while the ghost hands over to the server's Shunt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// powerups.js imports 'three' as the browser's import map names it.
const vendor = new URL('./vendor/', import.meta.url).href;
register(`data:text/javascript,export const resolve = (s, c, next) => next(s === 'three' ? '${vendor}three.module.js' : s.startsWith('three/addons/') ? '${vendor}addons/' + s.slice(13) : s, c);`);
let clock = 0;
performance.now = () => clock;
globalThis.document = { createElement: () => ({ style: {}, append() {} }), getElementById: () => null, body: { append() {} } }; // the fallback HUD
const { Game } = await import('../server/game.js');
const { KEY } = await import('../shared/movement.js');
const { eyeOf } = await import('../shared/weapons.js');
const net = await import('./net.js');
const pu = await import('./powerups.js');
const { readFile } = await import('node:fs/promises');
const { pads: PADS } = JSON.parse(await readFile(new URL('../shared/maps/arena_01.json', import.meta.url)));
pu.setPads(PADS);
const { ENT } = await import('../shared/protocol.js');

// First, while the module has seen no snapshot: the lobby's view.
test('before any snapshot, every pad is up at its pool\'s first item', () => {
  assert.deepEqual(pu.padStates().map((p) => [p.kind, p.up]), PADS.map((p) => [p.pool[0], true]));
});

const STEP = 1000 / 60;
const PRESS = 200;

// Press Q holding a Shunt at (0, 0) facing -z, with another player at
// (x, z). Returns [ms after the press, metres down the flight or null] for
// every frame from a step after the press to 400 ms.
function launch(x, z) {
  const LAT = 2; // ms each way
  const flat = { boxes: [{ pos: [0, -0.5, 0], size: [200, 1, 200] }], spawns: [[0, 0, 0], [30, 0, 0]] };
  const game = new Game('flat', flat);
  const queue = []; // [time, fn], run in time order
  const later = (at, fn) => queue.push([at, fn]);
  const [me, other] = [0, 1].map((i) => {
    const send = (d) => i === 0 && later(clock + LAT, () => {
      const m = JSON.parse(d);
      if (m.t === 'snapshot') {
        net.bufferSnapshot(m, clock);
        pu.onSnapshot(m);
      } else if (m.t === 'event') pu.onEvent(m, me.id);
    });
    const conn = { ws: { readyState: 1, OPEN: 1, bufferedAmount: 0, terminate() {}, send } };
    game.handle(conn, { t: 'join', name: `p${i}` });
    return conn.player;
  });
  game.handle(me.conn, { t: 'start' });
  Object.assign(me.mover, { x: 0, z: 0, grounded: true });
  Object.assign(other.mover, { x, z, grounded: true });
  me.protectedUntil = 0;
  other.protectedUntil = 0;
  me.pw.inv = ['shunt'];
  net.self.mover = { ...me.mover };
  pu.initPowerups({ boxes: game.map.boxes });
  pu.onEvent({ e: 'welcome' }, me.id);
  let s = 0;
  const start = clock + 1000; // the clock only runs forward, across tests too
  for (let k = 0; k < 60; k++) {
    later(start + k * STEP, () => game.step());
    const t = start + k * STEP + 5; // the client's steps, out of phase with the server's
    later(t, () => {
      const press = Math.abs(t - start - PRESS) < STEP / 2;
      const input = { t: 'input', s: ++s, rt: Math.floor(net.renderTick(clock)), keys: press ? KEY.USE : 0, yaw: 0, pitch: 0, fire: false, shot: 0, slot: 0 };
      later(clock + LAT, () => me.receive(input, clock));
      if (press) pu.cast('shunt', input);
    });
  }
  const eyeZ = eyeOf(me.mover)[2];
  const drawn = []; // [time, metres down the flight] per frame after the press
  for (let t = 1; t < 60 * STEP; t += 1000 / 144) {
    later(start + t, () => {
      pu.updatePowerups(clock, net.renderTick(clock), { position: { x: 0, y: 1.6, z: 3 } });
      const since = clock - start - PRESS;
      if (since < STEP || since > 400) return;
      const cubes = pu.powerupsGroup.children[2];
      const a = cubes.instanceMatrix.array;
      let z = null;
      for (let i = 0; i < cubes.count && z === null; i++) {
        const o = i * 16; // the rocket body: 0.25 wide, 0.6 long
        if (Math.abs(Math.hypot(a[o], a[o + 1], a[o + 2]) - 0.25) < 0.01 && Math.abs(Math.hypot(a[o + 8], a[o + 9], a[o + 10]) - 0.6) < 0.01) z = a[o + 14];
      }
      drawn.push([since, z === null ? null : eyeZ - z]);
    });
  }
  while (queue.length) {
    queue.sort((x, y) => x[0] - y[0]);
    const [at, fn] = queue.shift();
    clock = at;
    fn();
  }
  return drawn;
}

test('an own Shunt flies on at about 18 m/s from the press through the ghost\'s handover', () => {
  const drawn = launch(30, 30);
  assert.ok(drawn.length > 50);
  for (let i = 1; i < drawn.length; i++) {
    const [[t0, d0], [t1, d1]] = [drawn[i - 1], drawn[i]];
    assert.ok(d0 !== null && d1 !== null, `drawn at ${t1.toFixed(0)} ms`);
    const speed = ((d1 - d0) / (t1 - t0)) * 1000;
    assert.ok(speed > 12 && speed < 20, `${speed.toFixed(1)} m/s at ${t1.toFixed(0)} ms`);
  }
});

test('a point-blank Shunt\'s ghost goes with its blast, though its entity never showed', () => {
  const drawn = launch(0, -0.8); // bursts on its launch tick
  assert.ok(drawn.some(([, d]) => d !== null)); // the ghost flew
  assert.ok(drawn.filter(([t]) => t > 60).every(([, d]) => d === null));
});

test('a Shock ring lies on the floor under a dome cast at a jumping target', () => {
  const tick = 1e5;
  pu.onSnapshot({ tick, pu: { pd: [], en: [[77, ENT.DOME, 0, 4, 1, 4, tick + 60, 0]] } }); // 1 m up, over the flat floor
  pu.updatePowerups(clock, tick, { position: { x: 0, y: 1.6, z: 3 } });
  const flats = pu.powerupsGroup.children[1];
  const data = flats.geometry.attributes.aData.array;
  const rings = [];
  for (let i = 0; i < flats.count; i++) if (data[i * 4 + 1] === 2) rings.push(flats.instanceMatrix.array[i * 16 + 13]);
  assert.equal(rings.length, 1);
  assert.ok(Math.abs(rings[0] - 0.01) < 1e-6, `ring at y ${rings[0]}`);
});

// ---- Pads: what the server says, never the client's clock (spec §2). ----
const CAM = { position: { x: 0, y: 1.6, z: 3 } };
const padSnapshot = (ready) => ({ tick: 2e5, pu: { pd: PADS.map((p, i) => [0, ready[i] ?? 0, 0]), en: [] } });

// Beam quads standing on pad i, from the beam mesh as drawn this frame.
function beamsOn(i) {
  const beams = pu.powerupsGroup.children[4];
  const a = beams.instanceMatrix.array;
  const [x, , z] = PADS[i].pos;
  let n = 0;
  for (let b = 0; b < (beams.visible ? beams.count : 0); b++) if (Math.hypot(a[b * 16 + 12] - x, a[b * 16 + 14] - z) < 0.1) n++;
  return n;
}

test('a pad the server still calls refilling has no beam, though our clock says its time is up', () => {
  pu.setMap({ boxes: [], pads: PADS });
  pu.onSnapshot(padSnapshot([1])); // pad 0 refilling, due at tick 1: long past
  pu.updatePowerups(clock, 2e5, CAM);
  assert.equal(pu.padStates()[0].up, false);
  assert.equal(beamsOn(0), 0);
  assert.equal(beamsOn(1), 2); // an up pad keeps its two crossed quads
});

// ---- Picks: yours chime and toast; someone else's is a quiet "taken". ----
const toastEl = { textContent: '', style: {}, getAnimations: () => [], animate: () => ({}) };
globalThis.document.getElementById = (id) => (id === 'toast' ? toastEl : null);
const ME = 101;

test('another player\'s pick plays the quiet taken sound, never your chime or toast', () => {
  pu.setMap({ boxes: [], pads: PADS });
  pu.onSnapshot(padSnapshot([]));
  const { own, other } = pu.cues;
  pu.onEvent({ t: 'event', e: 'pick', id: 202, pad: 1, k: 'shield', tick: 2e5 }, ME);
  pu.updatePowerups(clock, 2e5, CAM); // others' picks wait for the render tick
  assert.equal(pu.cues.other, other + 1);
  assert.equal(pu.cues.own, own);
  assert.equal(toastEl.textContent, '');
});

test('your own pick plays the chime and the toast at once', () => {
  const { own, other } = pu.cues;
  pu.onEvent({ t: 'event', e: 'pick', id: ME, pad: 0, k: 'shunt', tick: 2e5 }, ME);
  assert.equal(pu.cues.own, own + 1);
  assert.equal(pu.cues.other, other);
  assert.equal(toastEl.textContent, '+ SHUNT');
});

// ---- The pad cue: every pickup attempt gets an answer (spec §2). ----
const { createPowers } = await import('../shared/powerups.js');
function standOn(i, inv = []) {
  const [x, y, z] = PADS[i].pos;
  Object.assign(net.self, { alive: true, mover: { x, y, z, crouch: false }, pw: { ...createPowers(), inv } });
}

test('standing on a refilling pad gives "refill", with the next item and its sound once', () => {
  pu.setMap({ boxes: [], pads: PADS });
  pu.onSnapshot(padSnapshot([3e5])); // pad 0 refilling
  standOn(0);
  const { empty } = pu.cues;
  pu.updatePowerups(clock, 2e5, CAM);
  pu.updatePowerups(clock + STEP, 2e5, CAM);
  assert.equal(pu.padCue().state, 'refill');
  assert.equal(pu.padCue().kind, PADS[0].pool[0]);
  assert.equal(pu.cues.empty, empty + 1);
  standOn(1); // an up pad, room in the inventory: the server hands it over, no cue
  pu.updatePowerups(clock + 2 * STEP, 2e5, CAM);
  assert.equal(pu.padCue().state, '');
});

test('standing on an up pad with a full inventory gives "full", its sound once', () => {
  pu.onSnapshot(padSnapshot([]));
  standOn(1, ['shunt', 'bolt', 'mine']);
  const { full } = pu.cues;
  pu.updatePowerups(clock, 2e5, CAM);
  pu.updatePowerups(clock + STEP, 2e5, CAM);
  assert.equal(pu.padCue().state, 'full');
  assert.equal(pu.cues.full, full + 1);
  net.self.pw.inv.pop(); // used one: there is room, so the server hands it over
  pu.updatePowerups(clock + 2 * STEP, 2e5, CAM);
  assert.equal(pu.padCue().state, '');
});

// The server grabs for you on the tick the pad refills, so its snapshots
// never say "up": the pad goes from refilling straight to refilling again.
for (const order of ['pick, then snapshot', 'snapshot, then pick']) {
  test(`standing through a refill: after your grab, no "refill" again (${order})`, () => {
    pu.setMap({ boxes: [], pads: PADS });
    pu.onSnapshot(padSnapshot([1])); // refilling, and our clock already says it's due
    standOn(0);
    pu.updatePowerups(clock, 2e5, CAM);
    assert.equal(pu.padCue().state, 'refill');
    const { empty, own } = pu.cues;
    const pick = () => pu.onEvent({ t: 'event', e: 'pick', id: ME, pad: 0, k: PADS[0].pool[0], tick: 2e5 }, ME);
    const refilled = () => pu.onSnapshot(padSnapshot([3e5])); // the next refill, never a 0 between
    if (order.startsWith('pick')) { pick(); refilled(); } else { refilled(); pick(); }
    net.self.pw.inv.push(PADS[0].pool[0]);
    for (let k = 1; k <= 3; k++) pu.updatePowerups(clock + k * STEP, 2e5, CAM);
    assert.equal(pu.cues.own, own + 1);
    assert.equal(pu.padCue().state, '');
    assert.equal(pu.cues.empty, empty);
  });
}
