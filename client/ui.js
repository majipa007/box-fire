// DOM screens. Player names come from the network, so they are only ever
// inserted with textContent.
import { PLAYER_COLORS } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);

// Per-browser settings. Storage can be missing or blocked, so every access is
// guarded and the defaults always work.
const SETTINGS_KEY = 'boxfire.settings';
export const settings = { sens: 2, fov: 90, ...loadSettings() };

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
}

export function initMenu({ onPlay, onChange }) {
  for (const [id, key] of [['set-sens', 'sens'], ['set-fov', 'fov']]) {
    const input = $(id);
    const out = input.nextElementSibling;
    input.value = settings[key];
    out.textContent = input.value;
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      out.textContent = input.value;
      saveSettings();
      onChange();
    });
  }
  $('play').addEventListener('click', onPlay);
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

export function showStats(text) {
  $('stats').hidden = false;
  $('stats').textContent = text;
}

const REJECT_TEXT = {
  'name-taken': 'That name is already taken.',
  'full': 'The game is full.',
  'bad-name': 'Use 1 to 16 characters.',
};

export function onJoin(fn) {
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
    ping.textContent = p.bot ? 'bot' : `${p.ping} ms`;
    li.append(swatch, name, ping);
    return li;
  }));
  const isHost = m.host === myId;
  $('start').hidden = !(isHost && m.phase === 'lobby');
  $('lobby-status').textContent = m.phase === 'lobby' ? (isHost ? '' : 'Waiting for host…') : 'Match in progress.';
}
