// Boot: connect to the host, drive the screens, run the render loop.
import { connect } from './net.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as input from './input.js';
import { cleanName } from '../shared/protocol.js';
import { EYE_STAND, EYE_CROUCH, TICK_RATE } from '../shared/constants.js';
import { createMover, step } from '../shared/movement.js';
import { prepareMap } from '../shared/collision.js';

const STEP_MS = 1000 / TICK_RATE;
const lerp = (a, b, t) => a + (b - a) * t;

let myId = null;
let mapId = null;
let inGame = false;

const net = connect({
  welcome(m) {
    myId = m.id;
    mapId = m.map;
    ui.showRoom();
  },
  lobby(m) {
    ui.renderLobby(m, myId);
    if (!inGame && myId !== null && m.phase !== 'lobby') enterGame();
  },
  reject(m) { ui.showJoinError(m.reason); },
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

async function enterGame() {
  inGame = true;
  ui.enterGame();
  render.init();
  const canvas = render.renderer.domElement;
  input.init(canvas, {
    onLockChange: (locked) => (locked ? ui.hideMenu() : ui.showMenu(true)),
    onLockError: ui.showLockError,
  });
  ui.initMenu({ onPlay: () => input.requestLock(canvas), onChange: applySettings });
  applySettings();
  ui.showMenu(false);

  const map = await (await fetch(new URL(`../shared/maps/${mapId}.json`, import.meta.url))).json();
  render.addMap(map);
  const { boxes, spawns } = prepareMap(map);
  const [x, y, z] = spawns[0];
  input.look.yaw = Math.atan2(x, z); // face the arena centre
  const me = createMover(x, y, z);
  let prev = { x, y, z };

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
      prev = { x: me.x, y: me.y, z: me.z };
      step(me, input.sample(), boxes);
    }
    const a = acc / STEP_MS;
    eye = lerp(eye, me.crouch ? EYE_CROUCH : EYE_STAND, Math.min(1, frameMs / 60)); // ease, don't snap
    render.setView(lerp(prev.x, me.x, a), lerp(prev.y, me.y, a) + eye, lerp(prev.z, me.z, a), input.look.yaw, input.look.pitch);
    render.draw();
    frames++;
    if (debug && now - statsAt > 500) {
      const { calls, triangles } = render.renderer.info.render;
      const pos = [me.x, me.y, me.z].map((v) => v.toFixed(2)).join(', ');
      ui.showStats(`${Math.round((frames * 1000) / (now - statsAt))} fps · ${calls} draws · ${triangles} tris · ${pos}`);
      frames = 0;
      statsAt = now;
    }
  });
}
