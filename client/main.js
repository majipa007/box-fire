// Boot: connect to the host, drive the screens, run the game loop.
import { connect, self, predict, reconcile, bufferSnapshot, renderTick, others } from './net.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as input from './input.js';
import { cleanName, encodeInput } from '../shared/protocol.js';
import { EYE_STAND, EYE_CROUCH, TICK_RATE } from '../shared/constants.js';
import { createMover } from '../shared/movement.js';
import { prepareMap } from '../shared/collision.js';

const STEP_MS = 1000 / TICK_RATE;
const lerp = (a, b, t) => a + (b - a) * t;

let myId = null;
let mapId = null;
let inGame = false;
let world = null; // prepared map, once loaded
let roster = new Map(); // id → { name, slot, bot } from the lobby list
let prev = null; // own position before the last fixed step, for smooth rendering

const net = connect({
  welcome(m) {
    myId = m.id;
    mapId = m.map;
    ui.showRoom();
  },
  lobby(m) {
    roster = new Map(m.players.map((p) => [p.id, p]));
    ui.renderLobby(m, myId);
    if (!inGame && myId !== null && m.phase !== 'lobby') enterGame();
  },
  reject(m) { ui.showJoinError(m.reason); },
  snapshot(m) {
    bufferSnapshot(m, performance.now());
    if (world) reconcile(m, world.boxes);
  },
  event(m) {
    if (m.e === 'spawn' && m.id === myId) {
      self.mover = { ...createMover(m.x, m.y, m.z), grounded: true }; // as the server does
      self.pending = [];
      prev = { x: m.x, y: m.y, z: m.z };
      input.look.yaw = m.yaw;
      input.look.pitch = 0;
    }
  },
  close() { ui.showDisconnected(); },
});

ui.onJoin((raw) => {
  const name = cleanName(raw);
  if (name) net.send({ t: 'join', name });
  else ui.showJoinError('bad-name');
});
ui.onStart(() => net.send({ t: 'start' }));

function applySettings() {
  input.setSensitivity(ui.settings.sens);
  render.setFov(ui.settings.fov);
}

// One fixed 60 Hz step: sample input, predict locally, send to the host.
function fixedStep() {
  const me = self.mover;
  if (!me || !world) return;
  prev = { x: me.x, y: me.y, z: me.z };
  const inp = { ...input.sample(), rt: renderTick(performance.now()), fire: false, shot: 0, slot: 0 };
  predict(inp, world.boxes);
  net.send(encodeInput(inp));
}

async function enterGame() {
  inGame = true;
  ui.enterGame();
  render.init();
  const canvas = render.renderer.domElement;
  input.init(canvas, {
    onLockChange: (locked) => (locked ? ui.hideMenu() : ui.showMenu(true)),
    onLockError: ui.showLockError,
    onNeutral: fixedStep, // one immediate step with no keys held
  });
  ui.initMenu({ onPlay: () => input.requestLock(canvas), onChange: applySettings });
  applySettings();
  ui.showMenu(false);

  const map = await (await fetch(new URL(`../shared/maps/${mapId}.json`, import.meta.url))).json();
  render.addMap(map);
  world = prepareMap(map);

  const debug = new URLSearchParams(location.search).has('debug');
  let frames = 0;
  let statsAt = performance.now();
  let acc = 0;
  let last = performance.now();
  let eye = EYE_STAND;
  requestAnimationFrame(function frame(now) {
    requestAnimationFrame(frame);
    // Fixed 60 Hz steps on the wall clock; render between the last two.
    const frameMs = now - last;
    acc += frameMs;
    last = now;
    if (acc > 250) acc = STEP_MS; // after a long stall, don't fast-forward
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      fixedStep();
    }
    const me = self.mover;
    if (me) {
      const a = acc / STEP_MS;
      eye = lerp(eye, me.crouch ? EYE_CROUCH : EYE_STAND, Math.min(1, frameMs / 60)); // ease, don't snap
      render.setView(lerp(prev.x, me.x, a), lerp(prev.y, me.y, a) + eye, lerp(prev.z, me.z, a), input.look.yaw, input.look.pitch);
    }
    render.syncPlayers(others(now).filter((o) => o.id !== myId), roster, frameMs / 1000);
    render.draw();
    frames++;
    if (debug && now - statsAt > 500) {
      const { calls, triangles } = render.renderer.info.render;
      const pos = me ? [me.x, me.y, me.z].map((v) => v.toFixed(2)).join(', ') : '-';
      ui.showStats(`${Math.round((frames * 1000) / (now - statsAt))} fps · ${calls} draws · ${triangles} tris · ${pos} · pending ${self.pending.length}`);
      frames = 0;
      statsAt = now;
    }
  });
}
