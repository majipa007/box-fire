// DOM screens. Player names come from the network, so they are only ever
// inserted with textContent.
import { PLAYER_COLORS, NAME_MAX, PRIMARIES } from '../shared/constants.js';
import { byScore } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);

// Per-browser settings. Storage can be missing or blocked, so every access is
// guarded and the defaults always work.
const SETTINGS_KEY = 'boxfire.settings';
export const settings = {
  // world: shadows default on; the sun shadow is baked once, so it is cheap.
  sens: 2, fov: 90, scale: 100, shadows: true, xsize: 4, xcolor: '#00ff00', primary: 'rifle', ...loadSettings(),
};

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
}

const CONTROLS = [['set-sens', 'sens'], ['set-fov', 'fov'], ['set-scale', 'scale'], ['set-shadows', 'shadows'], ['set-xsize', 'xsize'], ['set-xcolor', 'xcolor']];

function showControls() {
  for (const [id, key] of CONTROLS) {
    const input = $(id);
    if (input.type === 'checkbox') input.checked = settings[key];
    else input.value = settings[key];
    input.nextElementSibling.textContent = input.type === 'checkbox' || input.type === 'color' ? '' : input.value;
  }
}

export function initMenu({ onPlay, onChange }) {
  for (const [id, key] of CONTROLS) {
    $(id).addEventListener('input', (e) => {
      const input = e.target;
      settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'color' ? input.value : Number(input.value);
      showControls();
      saveSettings();
      onChange();
    });
  }
  $('low-end').addEventListener('click', () => {
    Object.assign(settings, { scale: 50, shadows: false });
    showControls();
    saveSettings();
    onChange();
  });
  showControls();
  $('play').addEventListener('click', onPlay);
}

// Key rebinding. bindings is input.js's action → KeyboardEvent.code map;
// it is edited in place and saved with the settings.
const ACTION_NAMES = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right',
  jump: 'Jump', walk: 'Walk', crouch: 'Crouch', reload: 'Reload',
  primary: 'Primary weapon', pistol: 'Pistol', picker: 'Pick primary', scoreboard: 'Scoreboard',
};
const keyName = (code) => code.replace(/^Key|^Digit/, '').replace(/^(.+?)(Left|Right)$/, '$2 $1'); // ShiftLeft → Left Shift

export function initKeys(bindings) {
  Object.assign(bindings, settings.keys);
  let listening = null; // action waiting for a key
  const render = () => {
    $('keys').replaceChildren(...Object.keys(ACTION_NAMES).flatMap((action) => {
      const label = document.createElement('span');
      label.textContent = ACTION_NAMES[action];
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = listening === action ? 'Press a key…' : keyName(bindings[action]);
      button.className = listening === action ? 'listening' : '';
      button.addEventListener('click', () => {
        listening = action;
        render();
      });
      return [label, button];
    }));
  };
  // Capture phase, so the game never sees the key being bound.
  addEventListener('keydown', (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code !== 'Escape') {
      // Taking a key another action uses swaps the two, so nothing is left unbound.
      const other = Object.keys(bindings).find((a) => bindings[a] === e.code);
      if (other) bindings[other] = bindings[listening];
      bindings[listening] = e.code;
      settings.keys = { ...bindings };
      saveSettings();
    }
    $('keys-warning').textContent = Object.values(bindings).some((c) => c.startsWith('Control'))
      ? 'Careful: Ctrl+W closes the tab, so Ctrl plus W mid-game quits.'
      : '';
    listening = null;
    render();
  }, true);
  render();
}

export function applyCrosshair() {
  const el = $('crosshair');
  const size = Number(settings.xsize) || 4;
  Object.assign(el.style, { width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px 0 0 ${-size / 2}px`, background: settings.xcolor });
}

export function enterGame() {
  $('lobby').hidden = true;
  $('hud').hidden = false;
}

export function showMenu(paused) {
  $('menu').hidden = false;
  $('menu-title').textContent = paused ? 'Paused' : 'Boxfire';
  $('play').textContent = paused ? 'Resume' : 'Click to play';
}

export function hideMenu() {
  $('menu').hidden = true;
  $('menu-error').textContent = '';
}

export function showLockError() {
  $('menu-error').textContent = 'The browser refused the mouse lock. Click again.';
}

// HUD. Text only changes when the value does.
const shown = {};
function setText(id, text) {
  if (shown[id] === text) return;
  shown[id] = text;
  $(id).textContent = text;
}

export function updateHud(hp, weapon, mag, reloading) {
  setText('hp', `${hp} HP`);
  setText('ammo', `${weapon}  ${reloading ? 'reloading…' : `${mag} / ∞`}`);
}

let hitTimer = 0;
export function hitMarker(head) {
  const el = $('hitmarker');
  el.style.color = head ? '#ff4d4d' : '#ffffff';
  el.classList.add('show');
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => el.classList.remove('show'), 120);
}

export function addKill(killer, victim, weapon, head, mine) {
  const li = document.createElement('li');
  li.textContent = `${killer}  ⟶  ${victim}  · ${weapon}${head ? ' · headshot' : ''}`;
  if (mine) li.className = 'mine';
  $('killfeed').prepend(li);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => li.remove(), 6000);
}

// A red arc on a ring around the crosshair, toward whoever just hit you.
// angle: radians clockwise from straight ahead.
let damageTimer = 0;
export function damageArc(angle) {
  const el = $('damage');
  el.style.transform = `rotate(${angle}rad)`;
  el.classList.add('show');
  clearTimeout(damageTimer);
  damageTimer = setTimeout(() => el.classList.remove('show'), 50);
}

let deathTimer = 0;
export function showDeath(killer, seconds) {
  const el = $('death');
  el.hidden = false;
  const end = performance.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
    el.textContent = `Eliminated by ${killer}\nRespawning in ${left}…`;
    if (left > 0) deathTimer = setTimeout(tick, 200);
  };
  el.style.whiteSpace = 'pre-line';
  clearTimeout(deathTimer);
  tick();
}

export function hideDeath() {
  clearTimeout(deathTimer);
  $('death').hidden = true;
}

// The primary picker: B toggles it, the respawn screen shows it.
export function initPicker(onPick) {
  for (const primary of PRIMARIES) $(`pick-${primary}`).addEventListener('click', () => onPick(primary));
}

export function showPicker(open) {
  $('picker').hidden = !open;
  for (const primary of PRIMARIES) $(`pick-${primary}`).classList.toggle('chosen', settings.primary === primary);
}

export const pickerOpen = () => !$('picker').hidden;

// Match clock and leader, top centre.
export function updateMatchInfo(secondsLeft, leader) {
  const s = Math.max(0, Math.ceil(secondsLeft));
  const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  setText('matchinfo', leader ? `${clock}   ·   ${leader.name}  ${leader.kills}` : clock);
}

// players: the lobby list. over: { winner, secondsLeft } once a match ends.
export function renderScoreboard(players, myId, over) {
  const ranked = [...players].sort(byScore);
  $('sb-rows').replaceChildren(...ranked.map((p) => {
    const tr = document.createElement('tr');
    if (p.id === myId) tr.className = 'me';
    else if (!p.connected) tr.className = 'gone';
    for (const text of [p.name, p.kills, p.deaths, !p.connected ? 'left' : p.bot ? 'bot' : `${p.ping} ms`]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(td);
    }
    return tr;
  }));
  setText('sb-title', over ? (over.winner ? `${over.winner} wins` : 'Match over') : 'Scoreboard');
  setText('sb-sub', over ? `Next match in ${Math.max(0, Math.ceil(over.secondsLeft))} s` : '');
}

export const showScoreboard = (show) => { $('scoreboard').hidden = !show; };

export function showEndMatch(show) { $('end-match').hidden = !show; }
export const onEndMatch = (fn) => $('end-match').addEventListener('click', fn);

export function showStats(text) {
  $('stats').hidden = false;
  $('stats').textContent = text;
}

const REJECT_TEXT = {
  'name-taken': 'That name is already taken.',
  'full': 'The game is full.',
  'bad-name': `Use 1 to ${NAME_MAX} characters.`,
};

export function onJoin(fn) {
  $('name').maxLength = NAME_MAX;
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    fn($('name').value);
  });
}


export const onStart = (fn) => $('start').addEventListener('click', fn);

export function showJoinError(reason) {
  $('join-error').textContent = REJECT_TEXT[reason] ?? 'Could not join.';
}

export function showRoom() {
  $('join-form').hidden = true;
  $('lobby-room').hidden = false;
}

export function showDisconnected() {
  $('lobby').hidden = false;
  $('lobby-status').textContent = 'Disconnected from the host. Reload to rejoin.';
}

export function renderLobby(m, myId) {
  $('lobby-players').replaceChildren(...m.players.map((p) => {
    const li = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = PLAYER_COLORS[p.slot];
    const name = document.createElement('span');
    name.textContent = p.name + (p.id === m.host ? ' (host)' : '') + (p.id === myId ? ' (you)' : '');
    const ping = document.createElement('span');
    ping.className = 'ping';
    ping.textContent = !p.connected ? 'offline' : p.bot ? 'bot' : `${p.ping} ms`;
    li.append(swatch, name, ping);
    return li;
  }));
  const isHost = m.host === myId;
  $('start').hidden = !(isHost && m.phase === 'lobby');
  $('lobby-status').textContent = m.phase === 'lobby' ? (isHost ? '' : 'Waiting for host…') : 'Match in progress.';
}
