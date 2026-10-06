// Boot: connect to the host, drive the screens, run the game loop.
import { connect, self, predict, reconcile, bufferSnapshot, syncClock, serverTick, renderTick, others } from './net.js';
import * as ui from './ui.js';
import * as render from './render.js';
import * as input from './input.js';
import * as audio from './audio.js';
import { cleanName, encodeInput } from '../shared/protocol.js';
import { EYE_STAND, EYE_CROUCH, TICK_RATE, MAX_HP, RESPAWN_SECONDS, WEAPONS, WALK_SPEED } from '../shared/constants.js';
import { createMover } from '../shared/movement.js';
import { prepareMap } from '../shared/collision.js';
import { createArsenal, eyeOf, aimDir, traceShot, shotDirs, weaponOf } from '../shared/weapons.js';
import { shotRng } from '../shared/rng.js';

const STEP_MS = 1000 / TICK_RATE;
const lerp = (a, b, t) => a + (b - a) * t;

let myId = null;
let mapId = null;
let seed = 0; // the host's spread seed
let inGame = false;
let world = null; // prepared map, once loaded
let roster = new Map(); // id → { name, slot, bot, kills, deaths } from the lobby list
let lobby = { phase: 'lobby', end: 0, host: null, players: [] }; // the latest lobby message
let winner = null; // name of the last match's winner, for the scoreboard
let tabHeld = false;
let pendingName = ''; // the name we asked to join with
let prev = null; // own position before the last fixed step, for smooth rendering
const nameOf = (id) => roster.get(id)?.name ?? '?';

const net = connect({
  welcome(m) {
    ui.rememberName(pendingName);
    myId = m.id;
    mapId = m.map;
    seed = m.seed;
    ui.showRoom();
    if (ui.settings.primary !== 'rifle') net.send({ t: 'loadout', primary: ui.settings.primary });
  },
  lobby(m) {
    syncClock(m.tick, performance.now());
    roster = new Map(m.players.map((p) => [p.id, p]));
    lobby = m;
    ui.renderLobby(m, myId);
    ui.showEndMatch(m.host === myId && m.phase === 'playing');
    if (m.phase === 'playing') winner = null;
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
      self.arsenal = createArsenal(m.primary);
      self.hp = MAX_HP;
      self.alive = true;
      self.pending = [];
      prev = { x: m.x, y: m.y, z: m.z };
      input.look.yaw = m.yaw;
      input.look.pitch = 0;
      input.setSlot(0); // every life starts on the primary
      ui.hideDeath();
      ui.showPicker(false);
    } else if (m.e === 'shot') {
      for (const end of m.h) render.addTracer(m.o, end);
      audio.gunshot(m.w, ...heard(m.o[0], m.o[2]));
    } else if (m.e === 'hit') {
      if (m.a === myId) {
        ui.hitMarker(m.head);
        audio.hitTick(m.head);
      }
      const attacker = m.v === myId && self.mover && others(performance.now()).find((o) => o.id === m.a);
      if (attacker) {
        // Direction to the attacker relative to where we look: 0 ahead, + to the right.
        const dx = attacker.x - self.mover.x;
        const dz = attacker.z - self.mover.z;
        const { yaw } = input.look;
        ui.damageArc(Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw)));
      }
    } else if (m.e === 'match_end') {
      winner = m.winner === null ? null : nameOf(m.winner);
      ui.hideDeath();
      ui.showPicker(false);
    } else if (m.e === 'kill') {
      ui.addKill(nameOf(m.k), nameOf(m.v), m.w, m.head, m.k === myId || m.v === myId);
      if (m.v === myId) {
        audio.deathThud();
        self.alive = false;
        ui.showDeath(nameOf(m.k), RESPAWN_SECONDS);
        ui.showPicker(true);
      }
    }
  },
  close() { ui.showDisconnected(); },
});

ui.onJoin((raw) => {
  const name = cleanName(raw);
  if (!name) return ui.showJoinError('bad-name');
  pendingName = name;
  net.send({ t: 'join', name });
});
ui.onStart(() => net.send({ t: 'start' }));
ui.onEndMatch(() => net.send({ t: 'end_match' }));

// null toggles the picker; a primary is chosen for the next spawn.
function pick(primary) {
  if (!primary) return ui.showPicker(!ui.pickerOpen());
  ui.settings.primary = primary;
  ui.saveSettings();
  net.send({ t: 'loadout', primary });
  ui.showPicker(!self.alive); // stays up on the respawn screen
}

function applySettings() {
  input.setSensitivity(ui.settings.sens);
  render.setFov(ui.settings.fov);
}

// One fixed 60 Hz step: sample input, predict locally, send to the host.
function fixedStep() {
  const me = self.mover;
  if (!me || !world || !self.alive || lobby.phase !== 'playing') return;
  prev = { x: me.x, y: me.y, z: me.z };
  const inp = { ...input.sample(), rt: renderTick(performance.now()) };
  if (predict(inp, world.boxes)) {
    ownShot(inp); // along this packet's angles, before the kick moves them
    recoil(weaponOf(self.arsenal));
    audio.gunshot(weaponOf(self.arsenal));
  }
  net.send(encodeInput(inp));
}

// [distance, pan] of a sound at (x, z) as we hear it.
function heard(x, z) {
  if (!self.mover) return [0, 0];
  const dx = x - self.mover.x;
  const dz = z - self.mover.z;
  const { yaw } = input.look;
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw); // + to our right
  const dist = Math.hypot(dx, dz);
  return [dist, dist > 0.5 ? Math.max(-1, Math.min(1, right / dist)) : 0];
}

// Footsteps: one every 2.2 m on the ground, only when running. Walking and
// crouching are silent, as the plan says.
const STRIDE = 2.2;
const strides = new Map(); // player id → { x, y, z, left }
function footsteps(id, p, dt, play) {
  const s = strides.get(id) ?? { x: p.x, y: p.y, z: p.z, left: STRIDE };
  const d = Math.hypot(p.x - s.x, p.z - s.z);
  const running = dt > 0 && d / dt > WALK_SPEED + 0.3 && d < 1 && Math.abs(p.y - s.y) < 0.02;
  if (running && (s.left -= d) <= 0) {
    s.left += STRIDE;
    play();
  }
  Object.assign(s, { x: p.x, y: p.y, z: p.z });
  strides.set(id, s);
}

// Recoil: the gun kicks and the camera climbs, more with each shot of a
// spray. Client-side only: the next packet simply carries the new pitch.
let spray = 0;
let lastShotAt = -Infinity;
function recoil(weapon) {
  const now = performance.now();
  spray = now - lastShotAt < 300 ? spray + 1 : 1;
  lastShotAt = now;
  const [base, climb] = WEAPONS[weapon].kick;
  const deg = base + climb * Math.min(spray, 8);
  input.kick((deg * Math.PI) / 180, ((Math.random() - 0.5) * deg * Math.PI) / 180 / 4);
  render.gunKick();
}

// Draw our own tracers at once: the same seeded pellets the server will
// test, along the packet's angles, ending where each would hit the map or a
// player we can see.
function ownShot(inp) {
  const origin = eyeOf(self.mover);
  const targets = others(performance.now()).filter((o) => o.alive && o.id !== myId);
  const right = [Math.cos(inp.yaw), 0, -Math.sin(inp.yaw)];
  const fwd = aimDir(inp.yaw, inp.pitch);
  const muzzle = origin.map((o, i) => o + right[i] * 0.15 + fwd[i] * 0.4 - (i === 1 ? 0.12 : 0));
  for (const dir of shotDirs(inp.yaw, inp.pitch, weaponOf(self.arsenal), self.mover, shotRng(seed, myId, self.shots))) {
    const { t } = traceShot(origin, dir, world.boxes, targets);
    render.addTracer(muzzle, origin.map((o, i) => o + dir[i] * t));
  }
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
    onPicker: pick,
    pickerOpen: ui.pickerOpen,
    onScoreboard: (held) => { tabHeld = held; },
  });
  ui.initPicker(pick);
  ui.initMenu({
    onPlay: () => {
      audio.start(); // the same click unmutes audio
      input.requestLock(canvas);
    },
    onChange: applySettings,
  });
  applySettings();
  ui.showMenu(false);

  const map = await (await fetch(new URL(`../shared/maps/${mapId}.json`, import.meta.url))).json();
  render.addMap(map);
  world = prepareMap(map);

  // Fixed 60 Hz steps on the wall clock, on their own timer so a slow frame
  // on the GPU does not bunch inputs up.
  const start = performance.now();
  let steps = 0;
  setInterval(() => {
    const due = Math.floor((performance.now() - start) / STEP_MS);
    if (due - steps > 15) steps = due - 1; // asleep for > 250 ms: skip, the host has gone neutral
    for (; steps < due; steps++) fixedStep();
  }, 4);

  const debug = new URLSearchParams(location.search).has('debug');
  let frames = 0;
  let statsAt = performance.now();
  let last = performance.now();
  let eye = EYE_STAND;
  requestAnimationFrame(function frame(now) {
    requestAnimationFrame(frame);
    const frameMs = now - last;
    last = now;
    const me = self.mover;
    if (me) {
      const a = Math.min(1, Math.max(0, (now - start) / STEP_MS - steps)); // between the last two steps
      eye = lerp(eye, me.crouch ? EYE_CROUCH : EYE_STAND, Math.min(1, frameMs / 60)); // ease, don't snap
      render.setView(lerp(prev.x, me.x, a), lerp(prev.y, me.y, a) + eye, lerp(prev.z, me.z, a), input.look.yaw, input.look.pitch);
      ui.updateHud(self.hp, weaponOf(self.arsenal), self.arsenal.mags[self.arsenal.slot], self.arsenal.reload > 0);
      render.setGun(weaponOf(self.arsenal), self.alive && lobby.phase === 'playing');
    }
    const visible = others(now).filter((o) => o.alive && o.id !== myId);
    render.syncPlayers(visible, roster, frameMs / 1000);
    if (me && self.alive) footsteps(myId, me, frameMs / 1000, () => audio.footstep());
    for (const o of visible) footsteps(o.id, o, frameMs / 1000, () => audio.footstep(...heard(o.x, o.z)));
    // Match clock and leader; the scoreboard on Tab, and forced between matches.
    const secondsLeft = (lobby.end - serverTick(now)) / TICK_RATE;
    const leader = lobby.players.reduce((best, p) => (!best || p.kills > best.kills ? p : best), null);
    ui.updateMatchInfo(lobby.phase === 'playing' ? secondsLeft : 0, leader?.kills ? leader : null);
    const over = lobby.phase === 'scoreboard';
    ui.showScoreboard(over || tabHeld);
    if (over || tabHeld) ui.renderScoreboard(lobby.players, myId, over ? { winner, secondsLeft } : null);
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
