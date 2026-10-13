// Boot: connect to the host, drive the screens, run the game loop.
import { connect, self, predict, reconcile, bufferSnapshot, syncClock, serverTick, renderTick, others } from './net.js';
import * as ui from './ui.js';
import * as render from './render.js';
import { buildWorld, sun, setQuality } from './world.js'; // effects: sun, for puffs in shade; world: quality preset
import { charactersGroup, syncPlayers, hitFlash, fireKick, shatter as breakRig } from './characters.js'; // characters: rig events
import { setGun, gunKick, setSunShade, sunBlocked, muzzleWorld } from './viewmodel.js'; // viewmodel: sun shade, drawn muzzle
import { effectsGroup, updateEffects, initEffects, shot, muzzle as muzzleFlash, casing, deathBurst as explode } from './effects.js'; // effects: shots, deaths, casings
import { addRecoil, correct, resetFeel, updateFeel, crosshair, spreadPixels, feelStats, view, blastShake, setBob, spraying } from './feel.js'; // feel:
import * as input from './input.js';
import * as audio from './audio.js';
import * as powerups from './powerups.js'; // powerups: pads, entities, HUD
import { cleanName, encodeInput, byScore } from '../shared/protocol.js';
import { EYE_STAND, EYE_CROUCH, TICK_RATE, RESPAWN_SECONDS, WALK_SPEED, NEUTRAL_MS, PLAYER_COLORS } from '../shared/constants.js'; // effects: PLAYER_COLORS
import { prepareMap } from '../shared/collision.js';
import { initCharacters, setShadows as rigShadows } from './characters.js'; // characters: map, sun and camera; the shadows setting
import { SUN_DIR } from './world.js'; // characters: for the shadows-off fallback
import { Vector3 } from 'three';
import { freshLife, eyeOf, aimDir, traceShot, shotDirs, weaponOf, hitboxes } from '../shared/weapons.js'; // effects: hitboxes
import { shotRng } from '../shared/rng.js';
import { WEAPONS } from '../shared/constants.js'; // hud: reload progress
import * as characters from './characters.js'; // hud: nameTags(), once characters has it

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
let stage = null; // the world, built behind the lobby as soon as we are welcomed
let stepStart = 0; // the fixed-step clock: started when the match view opens
let steps = 0;
const nameOf = (id) => roster.get(id)?.name ?? '?';
const colorOf = (id) => PLAYER_COLORS[roster.get(id)?.slot]; // hud: names in their slot colour
const hudExtra = { reloadFrac: 0, shield: 0, nitro: 0, slowed: 0 }; // hud: reused every frame
const rankInfo = { rank: 0, of: 0 }; // hud:

const net = connect({
  welcome(m) {
    myId = m.id;
    mapId = m.map;
    seed = m.seed;
    ui.showRoom();
    if (ui.settings.primary !== 'rifle') net.send({ t: 'loadout', primary: ui.settings.primary });
    stage ??= buildStage();
  },
  lobby(m) {
    syncClock(m.tick, performance.now());
    if (m.phase === 'playing' && lobby.phase !== 'playing') audio.ui('start'); // audio: a match begins
    roster = new Map(m.players.map((p) => [p.id, p]));
    lobby = m;
    ui.renderLobby(m, myId);
    ui.showEndMatch(m.host === myId && m.phase === 'playing');
    if (m.phase === 'playing') winner = null;
    if (!inGame && myId !== null && m.phase !== 'lobby') enterGame();
  },
  reject(m) {
    ui.showJoinError(m.reason);
    audio.ui('error'); // audio:
  },
  snapshot(m) {
    bufferSnapshot(m, performance.now());
    // feel: shift the drawn path by the correction, then hide it behind an offset that fades.
    const d = world && reconcile(m, world.boxes);
    if (d && prev) {
      prev.x += d.x;
      prev.y += d.y;
      prev.z += d.z;
      correct(d);
    }
    powerups.onSnapshot(m); // powerups: pads and entities
    audio.snapshot(m, self, myId, heard); // audio: Shunt hiss and locks, mines, Shock warnings, pad hums, our Shield breaking
  },
  event(m) {
    powerups.onEvent(m, myId); // powerups: pickups, uses, blasts
    if (m.e === 'blast') blastShake(m, myId, self.alive && self.mover); // feel: blasts near us shake the camera ('boom' shakes from powerups' queued play())
    audio.event(m, myId, heard); // audio: the engine's pickups, uses and blasts (client/powerups.js plays the bible's)
    if ((m.e === 'pickup' || m.e === 'pick') && m.id === myId) ui.powerToast(m.k); // hud:
    if (m.e === 'spawn' && m.id === myId) {
      Object.assign(self, freshLife(m.x, m.y, m.z, m.primary)); // exactly as the server builds it
      self.pending = [];
      prev = { x: m.x, y: m.y, z: m.z };
      input.look.yaw = m.yaw;
      input.look.pitch = 0;
      input.setSlot(0); // every life starts on the primary
      resetFeel(); // feel: no kick owed, no offsets
      ui.hideDeath();
      ui.showPicker(false);
      audio.respawn(); // audio: un-muffles the world
    } else if (m.e === 'shot') {
      remoteShot(m.id, m.o, m.h, m.w); // their gun kicks; tracers from its muzzle, impacts, a casing (effects: m.w)
      audio.gunshot(m.w, ...heard(m.o[0], m.o[2]));
      audio.impacts(m.o, m.h, heard); // audio: surface hits and ricochets
    } else if (m.e === 'hit') {
      hitFlash(m.v); // characters: the victim flashes white
      if (m.a === myId) {
        ui.hitMarker(m.head, m.dmg === 0 ? 'shield' : undefined); // hud: shield kind (dmg 0: the shield soaked it all)
        audio.hit(m.dmg === 0 ? 'shield' : m.head ? 'head' : 'body'); // audio: no damage means a Shield took it all
      }
      if (m.v === myId) audio.hurt(m.dmg === 0); // audio:
      if (m.v === myId) ui.damageTaken(m.dmg); // hud:
      const attacker = m.v === myId && self.mover && (m.sx !== undefined ? { x: m.sx, z: m.sz } : others(performance.now()).find((o) => o.id === m.a)); // hud: power hits point at sx/sz
      if (attacker) {
        // Direction to the attacker relative to where we look: 0 ahead, + to the right.
        const dx = attacker.x - self.mover.x;
        const dz = attacker.z - self.mover.z;
        const { yaw } = input.look;
        ui.damageArc(Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw)));
      }
    } else if (m.e === 'match_end') {
      winner = m.winner === null ? null : nameOf(m.winner);
      audio.ui(m.winner === myId ? 'win' : 'lose'); // audio:
      ui.hideDeath();
      ui.showPicker(false);
    } else if (m.e === 'kill') {
      ui.addKill(nameOf(m.k), nameOf(m.v), m.w, m.head, m.k === myId || m.v === myId, { killer: colorOf(m.k), victim: colorOf(m.v) }); // hud: colours
      deathBurst(m.k, m.v, m.head); // effects: a headshot pops the helmet
      if (m.k === myId) audio.kill(m.head); // audio: layers over the hit tick
      if (m.k === myId && m.v !== myId) ui.killConfirm(nameOf(m.v), colorOf(m.v)); // hud:
      if (m.v === myId) {
        audio.deathThud();
        self.alive = false;
        ui.showDeath(nameOf(m.k), RESPAWN_SECONDS, { color: colorOf(m.k), weapon: m.w, killerHp: others(performance.now()).find((o) => o.id === m.k)?.hp }); // hud: death card
        ui.showPicker(true);
      }
    }
  },
  close() { ui.showDisconnected(); },
});

ui.onJoin((raw) => {
  audio.start(); // audio: the join is the first user gesture, so lobby sounds work and rendering starts early
  audio.ambience(true); // audio: the quarry's wind
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
  rigShadows(!!ui.settings.shadows); // characters: shadow map, or sun rays
  input.setSensitivity(ui.settings.sens);
  render.setFov(ui.settings.fov);
  render.setRenderScale(Math.min(ui.settings.quality === 'low' ? 0.7 : 1, Math.max(0.5, ui.settings.scale / 100))); // hud: Low caps the scale at 70%
  render.setShadows(!!ui.settings.shadows);
  setBob(ui.settings.bob !== false); // feel: the View bob setting, on unless turned off
  render.setBrightness(ui.settings.brightness); // hud:
  ui.applyCrosshair();
}

// One fixed 60 Hz step: sample input, predict locally, send to the host.
function fixedStep() {
  const me = self.mover;
  if (!me || !world || !self.alive || lobby.phase !== 'playing') return;
  prev = { x: me.x, y: me.y, z: me.z };
  const inp = { ...input.sample(), rt: renderTick(performance.now()) };
  audio.ownUse(self.inv, inp.keys); // audio: our own use on the engine's wire, before predict() takes the slot
  if (predict(inp, world.boxes)) {
    ownShot(inp); // along this packet's angles, before the kick moves them
    recoil(weaponOf(self.arsenal));
    audio.gunshot(weaponOf(self.arsenal));
    audio.casing(weaponOf(self.arsenal)); // audio: the case lands a moment later
    ui.crosshairPulse(); // hud:
  }
  net.send(encodeInput(inp));
  if (inp.power) powerups.cast(inp.power, inp); // powerups: ghosts, Bolt beams, sounds, the cast
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

// Recoil: the gun kicks and the camera climbs (client-side only).
function recoil(weapon) {
  addRecoil(weapon, performance.now()); // feel: eases into the aim, and back out, in updateFeel
  gunKick();
}

// Draw our own tracers at once: the same seeded pellets the server will
// test, along the packet's angles, ending where each would hit the map or a
// player we can see.
function ownShot(inp) {
  const origin = eyeOf(self.mover);
  const targets = shotTargets(); // effects: in their slot colours
  const muzzle = muzzleWorld(render.camera, ownMuzzle).toArray(); // where the drawn gun's muzzle shows
  const dirs = shotDirs(inp.yaw, inp.pitch, weaponOf(self.arsenal), self.mover, shotRng(seed, myId, self.shots)); // effects: named, for the count
  const ends = []; // audio: world hits only; the host confirms player hits
  const all = []; // effects: every pellet's end
  for (const dir of dirs) {
    const { t, id } = traceShot(origin, dir, world.boxes, targets);
    const end = origin.map((o, i) => o + dir[i] * t); // effects:
    all.push(end); // effects:
    if (id === null) ends.push(end);
  }
  shot({ from: muzzle, eye: origin, ends: all, weapon: weaponOf(self.arsenal), targets }); // effects: tracers and impacts, capped per shot; our casings are the viewmodel's
  audio.impacts(origin, ends, heard); // audio:
}

// effects: the living players a shot can hit (never our own body: we look
// out from inside it), in their slot colours.
const shotTargets = () => others(performance.now()) // effects:
  .filter((o) => o.alive && o.id !== myId) // effects:
  .map((o) => ({ ...o, color: PLAYER_COLORS[roster.get(o.id)?.slot] })); // effects:

const ownMuzzle = new Vector3();
const remoteMuzzle = new Vector3();

// A kill: the victim's drawn body breaks into cubes pushed away from the
// killer. characters.js hides the rig and hands back its posed parts (one
// box per part); effects.js voxelises and throws them. A victim we cannot see
// falls back to their hitboxes; our own death has no body to break.
function deathBurst(killerId, victimId, head) { // effects: head
  if (victimId === myId) return;
  const now = performance.now();
  const victim = others(now).find((o) => o.id === victimId);
  const killer = killerId === myId ? self.mover : others(now).find((o) => o.id === killerId);
  const push = victim && killer ? [victim.x - killer.x, 0, victim.z - killer.z] : null;
  const parts = breakRig(victimId, Infinity).map(({ part, position: p, scale: s, color }) => ({ // effects: part
    part, // effects: the helmet flies off whole on a headshot
    min: [p.x - s.x / 2, p.y - s.y / 2, p.z - s.z / 2],
    max: [p.x + s.x / 2, p.y + s.y / 2, p.z + s.z / 2],
    color,
  }));
  const color = PLAYER_COLORS[roster.get(victimId)?.slot];
  if (parts.length) explode(parts, color, push, head); // effects: head
  else if (victim) explode(Object.values(hitboxes(victim)), color, push, head); // effects: head
}

// Someone else's shot. The host sends their eye; the tracers start at the
// drawn shooter's muzzle, or where it would be (0.3 m right of the eye,
// 0.25 m down, 0.6 m out) when we can't see them, and a case flies out to
// their right.
function remoteShot(id, o, ends, weapon) { // effects: weapon
  if (!world) return; // the map is still loading: nothing to hit, nothing drawn
  const dx = ends[0][0] - o[0];
  const dz = ends[0][2] - o[2];
  const k = 1 / (Math.hypot(dx, dz) || 1);
  const right = [-dz * k, 0, dx * k];
  const gun = (ahead) => [o[0] + right[0] * 0.3 + dx * k * ahead, o[1] - 0.25, o[2] + right[2] * 0.3 + dz * k * ahead];
  // The drawn shooter's real muzzle when we can see them; else where it would be.
  const muzzle = fireKick(id, remoteMuzzle) ? remoteMuzzle.toArray() : gun(0.6);
  shot({ from: muzzle, eye: o, ends, weapon, targets: shotTargets() }); // effects: tracers or Bolt beams, impacts
  if (weapon === 'bolt') return; // effects: a Bolt has no flash or case
  muzzleFlash(muzzle, [dx * k, 0, dz * k]); // effects:
  casing(gun(0.2), right, weapon); // effects: within 15 m, Default preset only
}

// Everything heavy happens behind the lobby: the map fetch, the AO bake, the
// materials and the shader compile, so a match starts without a hitch. The
// lobby watches the arena from a slow orbit until we spawn.
async function buildStage() {
  render.init();
  applySettings();
  const map = await (await fetch(new URL(`../shared/maps/${mapId}.json`, import.meta.url))).json();
  audio.setWorld(map, mapId); // audio: surfaces for impacts and footsteps, the engine's pads
  setQuality(ui.settings.quality); // world: 'low' halves the AO rays and stills the sky
  buildWorld(render.scene, map);
  render.scene.add(charactersGroup, effectsGroup);
  world = prepareMap(map);
  powerups.initPowerups({ boxes: world.boxes }); // powerups: pads, entities, ghosts
  render.scene.add(powerups.powerupsGroup); // powerups:
  initEffects({ boxes: world.boxes, map, quality: ui.settings.quality, sunDir: sun.position.clone().normalize().toArray() }); // effects: debris lands on the map; shots find the face they hit
  render.renderer.compile(render.scene, render.camera); // build every shader now, not mid-fight
  initCharacters({ boxes: world.boxes, sunDir: SUN_DIR, quality: ui.settings.quality, camera: render.camera }); // characters: after compile, clear of other branches' lines
  requestAnimationFrame(frame);
}

// The match view: input, menus and the fixed-step clock.
async function enterGame() {
  inGame = true;
  await stage;
  ui.enterGame();
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

  // Fixed 60 Hz steps on the wall clock, on their own timer so a slow frame
  // on the GPU does not bunch inputs up.
  stepStart = performance.now();
  steps = 0;
  setInterval(() => {
    const due = Math.floor((performance.now() - stepStart) / STEP_MS);
    if ((due - steps) * STEP_MS > NEUTRAL_MS) steps = due - 1; // asleep that long: skip, the host has gone neutral
    for (; steps < due; steps++) fixedStep();
  }, 4);
}

// The lobby's camera: a slow orbit high over the arena.
const ORBIT = { radius: 26, height: 11, pitch: -0.32, period: 90 };
function orbitView(now) {
  const a = ((now / 1000) * 2 * Math.PI) / ORBIT.period;
  const x = Math.sin(a) * ORBIT.radius;
  const z = Math.cos(a) * ORBIT.radius;
  render.setView(x, ORBIT.height, z, Math.atan2(x, z), ORBIT.pitch);
}

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
// Photo mode for comparing looks: ?debug&cam=x,y,z,yaw,pitch pins the camera.
const photo = debug && params.get('cam')?.split(',').map(Number);
let frames = 0;
let statsAt = performance.now();
let last = performance.now();
let eye = EYE_STAND;
let shownGap = -1; // feel:

function frame(now) {
  requestAnimationFrame(frame);
  const frameMs = now - last;
  last = now;
  const me = inGame ? self.mover : null;
  if (me) {
    const a = Math.min(1, Math.max(0, (now - stepStart) / STEP_MS - steps)); // between the last two steps
    eye = lerp(eye, me.crouch ? EYE_CROUCH : EYE_STAND, Math.min(1, frameMs / 60)); // ease, don't snap
    const v = updateFeel(frameMs, now, input.look, self.alive && lobby.phase === 'playing' ? me : null, weaponOf(self.arsenal), spraying(self.arsenal)); // feel:
    render.setView(lerp(prev.x, me.x, a) + v.x, lerp(prev.y, me.y, a) + eye + v.y, lerp(prev.z, me.z, a) + v.z, input.look.yaw, input.look.pitch, v.roll); // feel: offsets, roll
    render.setFovKick(v.fov); // feel: Nitro widens the view
    // feel: the crosshair gap for the HUD, as --spread (CSS px) on #hud.
    const gap = Math.round(spreadPixels(crosshair.spread, render.camera.fov, innerHeight));
    if (gap !== shownGap) document.getElementById('hud').style.setProperty('--spread', `${(shownGap = gap)}px`);
    hudExtra.reloadFrac = 1 - self.arsenal.reload / WEAPONS[weaponOf(self.arsenal)].reload; // hud:
    hudExtra.shield = self.pw?.shield ?? 0; // hud:
    hudExtra.shieldSeconds = (self.pw?.shieldT ?? 0) / TICK_RATE; // hud: ticks
    hudExtra.nitro = me.boost / TICK_RATE; // hud: ticks
    hudExtra.slowed = me.slow / TICK_RATE; // hud: ticks
    ui.updateHud(self.hp, weaponOf(self.arsenal), self.arsenal.mags[self.arsenal.slot], self.arsenal.reload > 0, hudExtra); // hud: extra (powerups.js drives ui.updatePowers)
    ui.threat(powerups.threats?.(myId), me, input.look.yaw); // hud: once powerups has threats()
    setGun(weaponOf(self.arsenal), self.alive && lobby.phase === 'playing');
    setSunShade(ui.settings.shadows && sunBlocked(eyeOf(me), world.boxes) ? 1 : 0); // viewmodel: darker in the sun's shadow, when shadows are drawn
  } else {
    orbitView(now);
    setGun('rifle', false);
  }
  if (photo) render.setView(...photo);
  const visible = others(now).filter((o) => o.alive && o.id !== myId);
  syncPlayers(visible, roster, frameMs / 1000, world.boxes); // characters: the ground under each player
  ui.renderNameTags(characters.nameTags?.(render.camera, innerWidth, innerHeight)); // hud: DOM tags, once characters has nameTags()
  powerups.updatePowerups(now, renderTick(now), render.camera); // powerups: draw this frame, play due events
  // feel: our own steps sound on the camera bob's footfalls (one per 2.2 m,
  // from our exact velocity), so each dip lands with its step.
  if (me && view.step) audio.footstep(0, 0, me); // audio: me for the surface underfoot
  if (me && self.alive) audio.ground(me.grounded, me); // audio: landings
  for (const o of visible) footsteps(o.id, o, frameMs / 1000, () => audio.footstep(...heard(o.x, o.z), o)); // audio: o for the surface
  if (inGame) {
    // Match clock and leader; the scoreboard on Tab, and forced between matches.
    const secondsLeft = (lobby.end - serverTick(now)) / TICK_RATE;
    const ranked = [...lobby.players].sort(byScore); // hud: ranked, for your rank
    const [leader] = ranked;
    rankInfo.rank = ranked.findIndex((p) => p.id === myId) + 1; // hud:
    rankInfo.of = ranked.length; // hud:
    ui.updateMatchInfo(lobby.phase === 'playing' ? secondsLeft : 0, leader?.kills ? leader : null, rankInfo); // hud: rank
    const over = lobby.phase === 'scoreboard';
    ui.showScoreboard(over || tabHeld);
    if (over || tabHeld) ui.renderScoreboard(lobby.players, myId, over ? { winner, secondsLeft } : null);
  }
  updateEffects(now, render.camera); // effects: the camera, for the casing range and ?debug&fx
  if (ui.settings.dynres) render.frameTime?.(frameMs); // hud: once render has dynamic resolution
  render.draw();
  frames++;
  if (debug && now - statsAt > 500) {
    const { calls, triangles } = render.renderer.info.render;
    const pos = me ? [me.x, me.y, me.z].map((v) => v.toFixed(2)).join(', ') : '-';
    ui.showStats(`${Math.round((frames * 1000) / (now - statsAt))} fps · ${calls} draws · ${triangles} tris · ${pos} · pending ${self.pending.length} · ${feelStats()} · ${audio.stats().voices} voices`); // feel, audio: stats
    frames = 0;
    statsAt = now;
  }
}
