// Boot: connect to the host, drive the screens, run the game loop.
import { connect, self, predict, reconcile, bufferSnapshot, syncClock, serverTick, renderTick, others } from './net.js';
import * as ui from './ui.js';
import * as render from './render.js';
import { buildWorld } from './world.js';
import { charactersGroup, syncPlayers, hitFlash, fireKick, shatter as breakRig } from './characters.js'; // characters: rig events
import { setGun, gunKick } from './viewmodel.js';
import { effectsGroup, addTracer, updateEffects, setMap, classifyHit, impact, playerHit, shatter as explode, casing } from './effects.js'; // effects: impacts, hits, shatter, casings
import { recoilKick } from './feel.js';
import * as input from './input.js';
import * as audio from './audio.js';
import * as powerups from './powerups.js'; // powerups: pads, entities, HUD
import { cleanName, encodeInput, byScore } from '../shared/protocol.js';
import { EYE_STAND, EYE_CROUCH, TICK_RATE, RESPAWN_SECONDS, WALK_SPEED, NEUTRAL_MS, PLAYER_COLORS } from '../shared/constants.js'; // effects: PLAYER_COLORS
import { prepareMap } from '../shared/collision.js';
import { Vector3 } from 'three';
import { freshLife, eyeOf, aimDir, traceShot, shotDirs, weaponOf, hitboxes } from '../shared/weapons.js'; // effects: hitboxes
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
let prev = null; // own position before the last fixed step, for smooth rendering
const nameOf = (id) => roster.get(id)?.name ?? '?';

const net = connect({
  welcome(m) {
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
    powerups.onSnapshot(m); // powerups: pads and entities
  },
  event(m) {
    powerups.onEvent(m, myId); // powerups: pickups, uses, blasts
    if (m.e === 'spawn' && m.id === myId) {
      Object.assign(self, freshLife(m.x, m.y, m.z, m.primary)); // exactly as the server builds it
      self.pending = [];
      prev = { x: m.x, y: m.y, z: m.z };
      input.look.yaw = m.yaw;
      input.look.pitch = 0;
      input.setSlot(0); // every life starts on the primary
      ui.hideDeath();
      ui.showPicker(false);
    } else if (m.e === 'shot') {
      remoteShot(m.id, m.o, m.h); // their gun kicks; tracers from its muzzle, impacts, a casing
      audio.gunshot(m.w, ...heard(m.o[0], m.o[2]));
    } else if (m.e === 'hit') {
      hitFlash(m.v); // characters: the victim flashes white
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
      deathBurst(m.k, m.v);
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
  render.setRenderScale(Math.min(1, Math.max(0.5, ui.settings.scale / 100)));
  render.setShadows(!!ui.settings.shadows);
  ui.applyCrosshair();
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
let ownStride = STRIDE;
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

// Recoil: the gun kicks and the camera climbs (client-side only).
function recoil(weapon) {
  input.kick(...recoilKick(weapon, performance.now()));
  gunKick();
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
  const dirs = shotDirs(inp.yaw, inp.pitch, weaponOf(self.arsenal), self.mover, shotRng(seed, myId, self.shots)); // effects: named, for the count
  for (const dir of dirs) {
    const { t } = traceShot(origin, dir, world.boxes, targets);
    const end = origin.map((o, i) => o + dir[i] * t); // effects: named, for the impact
    addTracer(muzzle, end);
    hitEffects(origin, end, targets, 1 / Math.sqrt(dirs.length)); // effects:
  }
  // effects: the case flies out right of the gun, carried along with us.
  casing(origin.map((o, i) => o + right[i] * 0.3 + fwd[i] * 0.35 - (i === 1 ? 0.2 : 0)), right, [self.mover.vx, self.mover.vy, self.mover.vz]);
}

// effects: what a shot's end hit: chips and a hole in the map, cubes off a
// player (never our own body: we look out from inside it).
function hitEffects(origin, end, players, scale) {
  const hit = classifyHit(origin, end, players);
  if (hit.kind === 'wall') impact(end, hit.normal, hit.surface, scale);
  else if (hit.kind === 'player' && hit.id !== myId) playerHit(end, hit.dir, PLAYER_COLORS[roster.get(hit.id)?.slot], hit.head, scale);
}

// effects: someone else's shot. The host sends their eye; the tracers start
// at their gun, 0.3 m right of it, 0.25 m down and 0.6 m out (as
// characters.js draws it), and a case flies out to their right.
const remoteMuzzle = new Vector3();

// A kill: the victim's drawn body breaks into cubes pushed away from the
// killer. characters.js hides the rig and hands back its posed parts (one
// box per part); effects.js voxelises and throws them. A victim we cannot see
// falls back to their hitboxes; our own death has no body to break.
function deathBurst(killerId, victimId) {
  if (victimId === myId) return;
  const now = performance.now();
  const victim = others(now).find((o) => o.id === victimId);
  const killer = killerId === myId ? self.mover : others(now).find((o) => o.id === killerId);
  const push = victim && killer ? [victim.x - killer.x, 0, victim.z - killer.z] : null;
  const parts = breakRig(victimId, Infinity).map(({ position: p, scale: s, color }) => ({
    min: [p.x - s.x / 2, p.y - s.y / 2, p.z - s.z / 2],
    max: [p.x + s.x / 2, p.y + s.y / 2, p.z + s.z / 2],
    color,
  }));
  const color = PLAYER_COLORS[roster.get(victimId)?.slot];
  if (parts.length) explode(parts, color, push);
  else if (victim) explode(Object.values(hitboxes(victim)), color, push);
}

function remoteShot(id, o, ends) {
  if (!world) return; // the map is still loading: nothing to hit, nothing drawn
  const dx = ends[0][0] - o[0];
  const dz = ends[0][2] - o[2];
  const k = 1 / (Math.hypot(dx, dz) || 1);
  const right = [-dz * k, 0, dx * k];
  const gun = (ahead) => [o[0] + right[0] * 0.3 + dx * k * ahead, o[1] - 0.25, o[2] + right[2] * 0.3 + dz * k * ahead];
  // The drawn shooter's real muzzle when we can see them; else where it would be.
  const muzzle = fireKick(id, remoteMuzzle) ? remoteMuzzle.toArray() : gun(0.6);
  const players = others(performance.now()).filter((p) => p.alive);
  for (const end of ends) {
    addTracer(muzzle, end);
    hitEffects(o, end, players, 1 / Math.sqrt(ends.length));
  }
  casing(gun(0.2), right);
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
  ui.initKeys(input.bindings);
  applySettings();
  ui.showMenu(false);

  const map = await (await fetch(new URL(`../shared/maps/${mapId}.json`, import.meta.url))).json();
  buildWorld(render.scene, map);
  powerups.init(render.scene, mapId); // powerups: meshes and HUD
  render.scene.add(charactersGroup, effectsGroup);
  world = prepareMap(map);
  setMap(map); // effects: debris lands on the map; shots find the face they hit
  render.renderer.compile(render.scene, render.camera); // effects: build the effect shaders now, not mid-fight

  // Fixed 60 Hz steps on the wall clock, on their own timer so a slow frame
  // on the GPU does not bunch inputs up.
  const start = performance.now();
  let steps = 0;
  setInterval(() => {
    const due = Math.floor((performance.now() - start) / STEP_MS);
    if ((due - steps) * STEP_MS > NEUTRAL_MS) steps = due - 1; // asleep that long: skip, the host has gone neutral
    for (; steps < due; steps++) fixedStep();
  }, 4);

  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  // Photo mode for comparing looks: ?debug&cam=x,y,z,yaw,pitch pins the camera.
  const photo = debug && params.get('cam')?.split(',').map(Number);
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
      if (photo) render.setView(...photo);
      ui.updateHud(self.hp, weaponOf(self.arsenal), self.arsenal.mags[self.arsenal.slot], self.arsenal.reload > 0);
      setGun(weaponOf(self.arsenal), self.alive && lobby.phase === 'playing');
    }
    const visible = others(now).filter((o) => o.alive && o.id !== myId);
    syncPlayers(visible, roster, frameMs / 1000, world.boxes); // characters: the ground under each player
    powerups.update(now, visible); // powerups: draw this frame
    // Our own steps from our velocity, which is exact; frame-to-frame position
    // changes jump around because the mover only moves at 60 Hz.
    if (me && self.alive && me.grounded && Math.hypot(me.vx, me.vz) > WALK_SPEED + 0.3) {
      ownStride -= Math.hypot(me.vx, me.vz) * (frameMs / 1000);
      if (ownStride <= 0) {
        ownStride += STRIDE;
        audio.footstep();
      }
    }
    for (const o of visible) footsteps(o.id, o, frameMs / 1000, () => audio.footstep(...heard(o.x, o.z)));
    // Match clock and leader; the scoreboard on Tab, and forced between matches.
    const secondsLeft = (lobby.end - serverTick(now)) / TICK_RATE;
    const [leader] = [...lobby.players].sort(byScore);
    ui.updateMatchInfo(lobby.phase === 'playing' ? secondsLeft : 0, leader?.kills ? leader : null);
    const over = lobby.phase === 'scoreboard';
    ui.showScoreboard(over || tabHeld);
    if (over || tabHeld) ui.renderScoreboard(lobby.players, myId, over ? { winner, secondsLeft } : null);
    updateEffects(now);
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
