// Boot: connect to the host, drive the screens, run the render loop.
import { connect } from './net.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as input from './input.js';
import { cleanName } from '../shared/protocol.js';
import { EYE_STAND } from '../shared/constants.js';

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
  const [x, y, z] = map.spawns[0];
  input.look.yaw = Math.atan2(x, z); // face the arena centre

  const debug = new URLSearchParams(location.search).has('debug');
  let frames = 0;
  let statsAt = performance.now();
  requestAnimationFrame(function frame(now) {
    requestAnimationFrame(frame);
    render.setView(x, y + EYE_STAND, z, input.look.yaw, input.look.pitch);
    render.draw();
    frames++;
    if (debug && now - statsAt > 500) {
      const { calls, triangles } = render.renderer.info.render;
      ui.showStats(`${Math.round((frames * 1000) / (now - statsAt))} fps · ${calls} draws · ${triangles} tris`);
      frames = 0;
      statsAt = now;
    }
  });
}
