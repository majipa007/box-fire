// DOM screens and the HUD (docs/bible.md §6). Player names come from the
// network, so they are only ever inserted with textContent; the only markup
// written is the static SVG icons below. Per-frame setters only touch the
// DOM when a value changes.
import { PLAYER_COLORS, NAME_MAX, PRIMARIES, SECONDARIES, POWER_COLORS, WEAPONS, KILL_TARGET } from '../shared/constants.js'; // arsenal: SECONDARIES
import { byScore } from '../shared/protocol.js';
import { GUNS, GUN_IDS } from '../shared/guns/index.js'; // arsenal: each gun file's icon

// ---- Look: timings and the few colours CSS can't own. ----
const LOOK = {
  hitMs: 150, hitPopMs: 90, killXMs: 400, confirmMs: 1200, toastMs: 1000, arcMs: 600,
  vignetteMs: 400, vignetteBase: 0.15, vignettePerHp: 0.5 / 100, vignetteMax: 0.6,
  pulseMs: 80, pulsePx: 3, lowHp: 30, shieldMax: 60, useTicks: 60, boltShots: 3,
  feedRows: 5, feedMs: 6000, tags: 10, shuntRing: 80, // px at 1080p: the 160 px ring's radius
  hitColor: { body: '#ffffff', head: '#ff4d4d', shield: '#66fff0' },
  status: { nitro: '#3dff8f', slowed: '#ffb300', shield: '#66fff0' },
};
const ITEM_COLORS = { ...POWER_COLORS, repair: '#f2efe8' }; // repair: the provisional kit on main

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
// ?debug&hud=demo fills every element with demo data; ?debug&hud=death shows the death card.
const DEMO = params.has('debug') ? params.get('hud') : null;
let demoing = false;
const live = () => !DEMO || demoing; // per-frame setters ignore the game while the demo runs

const cache = {};
const $ = (id) => (cache[id] ??= document.getElementById(id)); // every element is static

// ---- Font: Chakra Petch, vendored as base64 so no .woff2 is ever served. ----
async function loadFont() {
  try {
    const { W600, W700 } = await import('./vendor/fonts/chakra-petch.js');
    for (const [b64, weight] of [[W600, '600'], [W700, '700']]) {
      const face = new FontFace('Chakra Petch', Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { weight });
      document.fonts.add(await face.load());
    }
  } catch { /* the fallback stack still reads fine */ }
}
if (typeof document !== 'undefined') loadFont();

// ---- Settings. Per browser; storage can be missing or blocked, so every
// access is guarded and the defaults always work. ----
const SETTINGS_KEY = 'boxfire.settings';
// Schema v2 resets the graphics keys once (v1 users saved shadows:false and a
// 50% scale from the old low-end button) and keeps keys, sensitivity, FOV,
// crosshair and primary.
const GRAPHICS = { shadows: true, scale: 100, quality: 'default', msaa: true, dynres: true, bob: true, brightness: 1 };
export const DEFAULTS = { v: 2, sens: 2, fov: 90, xsize: 4, xcolor: '#f2efe8', primary: 'rifle', secondary: 'pistol', ...GRAPHICS }; // arsenal: secondary
export function migrate(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return (Number(s.v) || 1) < 2 ? { ...s, ...GRAPHICS, v: 2 } : s;
}
export const settings = { ...DEFAULTS, ...migrate(loadSettings()) };

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
}

const CONTROLS = [
  ['set-sens', 'sens'], ['set-fov', 'fov'], ['set-scale', 'scale'], ['set-shadows', 'shadows'], ['set-xsize', 'xsize'], ['set-xcolor', 'xcolor'],
  ['set-quality', 'quality'], ['set-msaa', 'msaa'], ['set-dynres', 'dynres'], ['set-brightness', 'brightness'], ['set-bob', 'bob'],
];

function showControls() {
  for (const [id, key] of CONTROLS) {
    const input = $(id);
    if (input.type === 'checkbox') input.checked = settings[key];
    else input.value = settings[key];
    input.nextElementSibling.textContent = input.type === 'range' ? input.value : input.dataset.note ?? '';
  }
}

export function initMenu({ onPlay, onChange }) {
  for (const [id, key] of CONTROLS) {
    $(id).addEventListener('input', (e) => {
      const input = e.target;
      settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      showControls();
      saveSettings();
      onChange();
    });
  }
  showControls();
  $('play').addEventListener('click', onPlay);
}

// Key rebinding. bindings is input.js's action → KeyboardEvent.code map;
// it is edited in place and saved with the settings. Only actions input.js
// actually has are listed (main names the power-up keys usePowerup and
// cyclePowerup; the bible names them use and cycle).
const ACTION_NAMES = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right',
  jump: 'Jump', walk: 'Walk', crouch: 'Crouch', reload: 'Reload',
  primary: 'Primary weapon', pistol: 'Pistol', picker: 'Pick primary', scoreboard: 'Scoreboard',
  usePowerup: 'Use power-up', cyclePowerup: 'Next power-up', use: 'Use power-up', cycle: 'Next power-up',
  aim: 'Aim / scope', // arsenal
};
const MOUSE = ['Left mouse', 'Middle mouse', 'Right mouse', 'Mouse 4', 'Mouse 5']; // arsenal: Mouse<n> bindings
const keyName = (code = '') => MOUSE[/^Mouse(\d)$/.exec(code)?.[1]] ?? code.replace(/^Key|^Digit/, '').replace(/^(.+?)(Left|Right)$/, '$2 $1'); // ShiftLeft → Left Shift
let keys = {}; // the live bindings, for the power-up key labels

export function initKeys(bindings) {
  keys = bindings;
  for (const a in settings.keys) if (a in bindings) bindings[a] = settings.keys[a]; // a renamed action's old key stays out
  let listening = null; // action waiting for a key
  const render = () => {
    $('keys').replaceChildren(...Object.keys(ACTION_NAMES).filter((a) => a in bindings).flatMap((action) => {
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
  // arsenal: a mouse button other than the left (fire) binds as Mouse<n>.
  addEventListener('mousedown', (e) => {
    if (!listening || e.button === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    dispatchEvent(new KeyboardEvent('keydown', { code: `Mouse${e.button}` }));
  }, true);
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
  el.style.setProperty('--xc', settings.xcolor);
  el.style.setProperty('--xl', `${Math.round((7 * (Number(settings.xsize) || 4)) / 4)}px`);
}

export function enterGame() {
  $('lobby').hidden = true;
  $('hud').hidden = false;
  if (DEMO) startDemo();
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

// ---- Icons: 24 x 24 power-up glyphs in their hue (a dark outline comes from
// CSS), and kill-feed silhouettes. Static strings, never player data. ----
const svg = (vb, body) => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
const path = (d, extra = '') => `<path d="${d}" fill="currentColor"${extra}/>`;
const spikes = Array.from({ length: 16 }, (_, i) => {
  const a = (i * Math.PI) / 8 - Math.PI / 2;
  const r = i % 2 ? 7.2 : 11;
  return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
}).join(' L');
export const ICONS = {
  shunt: svg('0 0 24 24', path('M12 1.5 L20.5 21.5 L12 16.5 L3.5 21.5 Z')),
  bolt: svg('0 0 24 24', path('M14.5 1 L4 13.5 H10.8 L8.8 23 L20 9.5 H13.4 Z')),
  barge: svg('0 0 24 24', path('M7.86 2 H16.14 L22 7.86 V16.14 L16.14 22 H7.86 L2 16.14 V7.86 Z M10.34 8 L8 10.34 V13.66 L10.34 16 H13.66 L16 13.66 V10.34 L13.66 8 Z', ' fill-rule="evenodd"')),
  shock: svg('0 0 24 24', path('M3 17 A9 9 0 0 1 21 17 Z M1.5 18.5 H22.5 V22 H1.5 Z M11 2 H13 V5 H11 Z M3.6 5 L5 3.6 L7.1 5.7 L5.7 7.1 Z M20.4 5 L19 3.6 L16.9 5.7 L18.3 7.1 Z')),
  mine: svg('0 0 24 24', `${path(`M${spikes} Z`)}<circle cx="12" cy="12" r="3.2" fill="#ff2a1a"/>`),
  nitro: svg('0 0 24 24', path('M1.5 3 H6.5 L13 12 L6.5 21 H1.5 L8 12 Z M10.5 3 H15.5 L22 12 L15.5 21 H10.5 L17 12 Z')),
  shield: svg('0 0 24 24', `${path('M12 1.5 L21.1 6.75 V17.25 L12 22.5 L2.9 17.25 V6.75 Z')}<path d="M12 6 L17 8.9 V12 L12 9.1 L7 12 V8.9 Z" fill="#ffffff" fill-opacity="0.55" stroke="none"/>`),
  repair: svg('0 0 24 24', path('M9 2 H15 V9 H22 V15 H15 V22 H9 V15 H2 V9 H9 Z')),
  // arsenal: every gun's silhouette comes from its own file (shared/guns, icon: { w, h, d }).
  ...Object.fromEntries(GUN_IDS.map((id) => { const { w, h, d } = GUNS[id].icon; return [id, svg(`0 0 ${w} ${h}`, path(d))]; })),
  // A helmet in profile, facing right, with a crack through the shell.
  head: svg('0 0 22 18', `${path('M2 16 V9.5 C2 4.5 5.5 1.5 10.5 1.5 C15.5 1.5 18.5 4.5 19 9 L21 11.5 V13.5 H14 V16 Z')}<path d="M9.5 2 L7.6 6 L10.4 8.2 L8.6 12.5" fill="none" style="stroke-width:1.8px;paint-order:normal"/>`),
};
const CROWN = svg('0 0 20 14', '<path d="M1 3.5 L6 8 L10 1 L14 8 L19 3.5 L17 13 H3 Z" fill="#d9b45a"/>');
const CHEVRON = svg('0 0 18 18', '<path d="M9 1.5 L16.5 15 L9 11 L1.5 15 Z" fill="#ff2a1a" stroke="#15171c" stroke-width="1.5" paint-order="stroke"/>');
// width / height of the viewBox; power-up glyphs are square.
const ASPECT = { head: '1.22', ...Object.fromEntries(GUN_IDS.map((id) => [id, String(GUNS[id].icon.w / GUNS[id].icon.h)])) };

function setIcon(el, kind, color) {
  el.innerHTML = ICONS[kind] ?? '';
  el.style.aspectRatio = ASPECT[kind] ?? '1';
  el.style.color = ITEM_COLORS[kind] ?? color ?? '';
  return el;
}
const icon = (kind, color) => setIcon(Object.assign(document.createElement('span'), { className: 'ico' }), kind, color);

// One-shot animation, restarted on every call (no reflow, no timers). The
// demo freezes each one halfway, so screenshots catch it.
function flash(el, frames, ms) {
  el.getAnimations().forEach((a) => a.cancel());
  const a = el.animate(frames, { duration: ms, easing: 'ease-out' });
  if (DEMO) {
    a.pause();
    a.currentTime = ms / 2;
  }
}

// ---- HUD. ----
const shown = {};
function setText(id, text) {
  if (shown[id] === text) return;
  shown[id] = text;
  $(id).textContent = text;
}
const last = { hp: -1, weapon: '', mag: -1, maxMag: -1, reload: -1, reloading: null, low: null, shield: -1, ring: null, gap: -1, clock: -1, rank: -1, of: -1, leader: null, leaderKills: -1 };
const tagLast = { nitro: -1, slowed: -1, shield: -1 }; // tenths of a second shown, -1 hidden
const NONE = {};

// extra: { maxMag, reloadFrac (0 → 1), shield (hp), shieldSeconds, nitro and slowed (seconds left) }
export function updateHud(hp, weapon, mag, reloading, extra = NONE) {
  if (!live()) return;
  const { maxMag = WEAPONS[weapon]?.mag ?? 0, reloadFrac = 0, shield = 0, shieldSeconds = 0, nitro = 0, slowed = 0 } = extra;
  if (hp !== last.hp) {
    $('hp').textContent = hp;
    $('hp-fill').style.transform = `scaleX(${Math.max(0, hp) / 100})`;
    // The ghost holds the lost HP, then drains (CSS transition); it jumps up on a heal.
    const ghost = $('hp-ghost').style;
    ghost.transition = hp > last.hp ? 'none' : '';
    ghost.transform = `scaleX(${Math.max(0, hp) / 100})`;
    last.hp = hp;
    const low = hp > 0 && hp <= LOOK.lowHp;
    if (low !== last.low) {
      $('vitals').classList.toggle('low', low);
      $('lowhp').classList.toggle('on', low);
      last.low = low;
    }
  }
  const sh = Math.ceil(Math.max(0, shield));
  if (sh !== last.shield) {
    $('shieldbar').hidden = sh <= 0;
    $('shieldtint').hidden = sh <= 0;
    $('shieldbar').firstChild.style.transform = `scaleX(${Math.min(sh, LOOK.shieldMax) / LOOK.shieldMax})`;
    last.shield = sh;
  }
  statusTag('nitro', nitro > 0, nitro, 'NITRO');
  statusTag('slowed', slowed > 0, slowed, 'SLOWED');
  statusTag('shield', sh > 0, shieldSeconds, 'SHIELD');
  if (weapon !== last.weapon) {
    $('wname').textContent = WEAPONS[weapon]?.name ?? weapon; // arsenal: the gun's own name
    setIcon($('wicon'), weapon);
    last.weapon = weapon;
    const ring = weapon === 'shotgun';
    if (ring !== last.ring) $('crosshair').classList.toggle('ring', (last.ring = ring));
  }
  if (mag !== last.mag || maxMag !== last.maxMag || reloading !== last.reloading) {
    $('mag').textContent = mag;
    $('ammo').classList.toggle('reloading', reloading);
    $('ammo').classList.toggle('low', !reloading && mag <= Math.ceil(maxMag / 4));
    last.mag = mag;
    last.maxMag = maxMag;
    last.reloading = reloading;
  }
  const r = reloading ? Math.round(reloadFrac * 100) : 0;
  if (r !== last.reload) {
    $('reload').style.setProperty('--r', r / 100);
    last.reload = r;
  }
}

// A status pill with tenths of a second left (no number when unknown).
function statusTag(kind, on, seconds, label) {
  const tenths = on ? Math.ceil(seconds * 10) : -1;
  if (tenths === tagLast[kind]) return;
  const el = $(`tag-${kind}`);
  if ((tagLast[kind] < 0) !== (tenths < 0)) {
    el.hidden = tenths < 0;
    el.style.background = LOOK.status[kind];
  }
  tagLast[kind] = tenths;
  if (tenths >= 0) el.textContent = tenths > 0 ? `${label} ${(tenths / 10).toFixed(1)}` : label;
}

// The bible's gap formula in px; without calls, CSS sizes the gap from the
// --spread main.js writes on #hud. ring: the shotgun's pellet circle.
export function updateCrosshair(gapPx, ring = false) {
  if (!live()) return;
  const g = Math.round(gapPx);
  if (g !== last.gap) $('crosshair').style.setProperty('--gap', `${(last.gap = g)}px`);
  if (ring !== last.ring) $('crosshair').classList.toggle('ring', (last.ring = ring));
}

export function crosshairPulse() {
  if (!live()) return;
  $('crosshair').animate([{ '--pulse': `${LOOK.pulsePx}px` }, { '--pulse': '0px' }], { duration: LOOK.pulseMs, easing: 'ease-out' });
}

export function hitMarker(head, kind = head ? 'head' : 'body') {
  if (!live()) return;
  const el = $('hitmarker');
  el.style.setProperty('--hc', LOOK.hitColor[kind] ?? LOOK.hitColor.body);
  const pop = LOOK.hitPopMs / LOOK.hitMs;
  flash(el, [{ opacity: 1, transform: 'scale(1.3)' }, { opacity: 1, transform: 'scale(1)', offset: pop }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], LOOK.hitMs);
}

// You got the kill: a red X on the crosshair and the victim's name under it.
export function killConfirm(name, color) {
  if (!live()) return;
  flash($('killx'), [{ opacity: 1, transform: 'scale(1.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], LOOK.killXMs);
  const label = $('confirm-name');
  label.textContent = name;
  label.style.setProperty('--c', color ?? '');
  flash($('confirm'), [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none', offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], LOOK.confirmMs);
}

// colors: { killer, victim } hex. weapon may be a power id.
export function addKill(killer, victim, weapon, head, mine, colors = {}) {
  if (!live()) return;
  const li = document.createElement('li');
  const name = (text, color) => {
    const span = document.createElement('span');
    span.textContent = text;
    if (color) {
      span.className = 'who';
      span.style.setProperty('--c', color);
    }
    return span;
  };
  li.append(name(killer, colors.killer), icon(weapon));
  if (head) li.append(icon('head', LOOK.hitColor.head));
  li.append(name(victim, colors.victim));
  if (mine) li.className = 'mine';
  const feed = $('killfeed');
  feed.prepend(li);
  while (feed.children.length > LOOK.feedRows) feed.lastChild.remove();
  if (!DEMO) setTimeout(() => li.remove(), LOOK.feedMs);
}

// A red arc on a ring around the crosshair, toward whoever just hit you.
// angle: radians clockwise from straight ahead.
export function damageArc(angle) {
  if (!live()) return;
  const el = $('damage');
  el.style.transform = `rotate(${angle}rad)`;
  flash(el, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], LOOK.arcMs);
}

// A red flash at the screen's edge, stronger for bigger hits.
export function damageTaken(dmg) {
  if (!live() || !(dmg > 0)) return;
  const peak = Math.min(LOOK.vignetteMax, LOOK.vignetteBase + LOOK.vignettePerHp * dmg);
  flash($('vignette'), [{ opacity: peak }, { opacity: 0 }], LOOK.vignetteMs);
}

let deathTimer = 0;
// info: { color, weapon, killerHp }
export function showDeath(killer, seconds, info = {}) {
  if (!live()) return;
  $('death').hidden = false;
  const name = $('death-killer');
  name.textContent = killer;
  name.style.setProperty('--c', info.color ?? '');
  setIcon($('death-icon'), info.weapon);
  $('death-hp').textContent = info.killerHp > 0 ? `they had ${info.killerHp} HP` : '';
  const end = performance.now() + seconds * 1000;
  const timer = $('death-timer');
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
    timer.replaceChildren('Respawning in ', Object.assign(document.createElement('b'), { textContent: left }));
    if (left > 0 && !DEMO) deathTimer = setTimeout(tick, 200); // the demo holds its number
  };
  clearTimeout(deathTimer);
  tick();
}

export function hideDeath() {
  if (!live()) return;
  clearTimeout(deathTimer);
  $('death').hidden = true;
}

// The primary picker: B toggles it, the respawn screen shows it.
// arsenal: a row of primaries, then a row of sidearms, numbered 1..9, 0 in
// PICKS order (input.js maps the digit keys to the same list while it is open).
export const PICKS = [...PRIMARIES, ...SECONDARIES];
export function initPicker(onPick) {
  PICKS.forEach((id, i) => {
    const b = Object.assign(document.createElement('button'), { id: `pick-${id}`, type: 'button', textContent: `${(i + 1) % 10} · ${WEAPONS[id].name}` });
    b.addEventListener('click', () => onPick(id));
    $(`pick-${WEAPONS[id].slot}`).append(b);
  });
}

export function showPicker(open) {
  if (!live()) return;
  $('picker').hidden = !open;
  for (const id of PICKS) $(`pick-${id}`)?.classList.toggle('chosen', settings[WEAPONS[id].slot] === id); // arsenal
}

export const pickerOpen = () => !$('picker').hidden;

// Match clock, your rank and the leader's progress, top centre.
// leader: a lobby player { name, kills, slot }; me: { rank, of }.
export function updateMatchInfo(secondsLeft, leader, me = null) {
  if (!live()) return;
  const s = Math.max(0, Math.ceil(secondsLeft));
  if (s !== last.clock) {
    last.clock = s;
    $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  const rank = me?.rank ?? 0;
  const of = me?.of ?? 0;
  if (rank !== last.rank || of !== last.of) {
    last.rank = rank;
    last.of = of;
    $('rank').textContent = rank ? `#${rank} / ${of}` : '';
  }
  const kills = leader?.kills ?? -1;
  if (leader?.name !== last.leader || kills !== last.leaderKills) {
    last.leader = leader?.name;
    last.leaderKills = kills;
    $('leader').classList.toggle('none', !leader);
    if (leader) {
      $('leader-name').textContent = leader.name;
      $('leader-kills').textContent = `${kills} / ${KILL_TARGET}`;
      $('leader').style.setProperty('--lc', PLAYER_COLORS[leader.slot] ?? '');
      $('leader-bar').firstChild.style.transform = `scaleX(${Math.min(1, kills / KILL_TARGET)})`;
    }
  }
}

// ---- Power-up slots, bottom centre. pw: { inv, sel, cd (ticks), bolts }.
// On main today inv is a queue that fires its first item, so sel defaults to 0.
let slots = null;
const NO_ITEMS = [];
const lastPw = { kinds: ['', '', ''], sel: -1, cd: -1, bolts: -1, use: '', cycle: '', count: -1 };

function buildSlots() {
  const row = $('powers');
  slots = [0, 1, 2].map(() => {
    const el = document.createElement('div');
    el.className = 'pslot';
    el.append(Object.assign(document.createElement('span'), { className: 'ico' }), Object.assign(document.createElement('b'), { className: 'key' }));
    return el;
  });
  const pips = Object.assign(document.createElement('div'), { id: 'pips', hidden: true });
  pips.append(...Array.from({ length: LOOK.boltShots }, () => document.createElement('i')));
  const cycle = Object.assign(document.createElement('b'), { className: 'key', id: 'cycle-key', hidden: true });
  row.append(...slots, cycle, pips);
}

export function updatePowers(pw) {
  if (!live() || !pw || !$('powers')) return; // no HUD row: a test or a page without the HUD
  if (!slots) buildSlots();
  const inv = pw.inv ?? NO_ITEMS;
  for (let i = 0; i < 3; i++) {
    const kind = inv[i] ?? '';
    if (kind === lastPw.kinds[i]) continue;
    lastPw.kinds[i] = kind;
    const el = slots[i];
    el.classList.toggle('full', !!kind);
    el.style.setProperty('--c', ITEM_COLORS[kind] ?? 'transparent');
    el.firstChild.innerHTML = ICONS[kind] ?? '';
  }
  const sel = inv.length ? Math.min(pw.sel ?? 0, inv.length - 1) : -1;
  if (sel !== lastPw.sel) {
    slots.forEach((el, i) => el.classList.toggle('sel', i === sel));
    lastPw.sel = sel;
  }
  const useCode = keys.use ?? keys.usePowerup ?? 'KeyQ';
  const cycleCode = keys.cycle ?? keys.cyclePowerup ?? 'KeyE';
  if (useCode !== lastPw.use) {
    for (const el of slots) el.lastChild.textContent = keyName(useCode);
    lastPw.use = useCode;
  }
  if (cycleCode !== lastPw.cycle || inv.length !== lastPw.count) {
    const el = $('cycle-key');
    el.textContent = keyName(cycleCode);
    el.hidden = inv.length < 2;
    lastPw.cycle = cycleCode;
    lastPw.count = inv.length;
  }
  const cd = sel >= 0 ? Math.round(((pw.cd ?? 0) / LOOK.useTicks) * 50) / 50 : 0;
  if (cd !== lastPw.cd) {
    for (const el of slots) el.style.setProperty('--cd', cd);
    lastPw.cd = cd;
  }
  const bolts = pw.bolts ?? 0;
  if (bolts !== lastPw.bolts) {
    $('pips').hidden = bolts <= 0;
    [...$('pips').children].forEach((p, i) => p.classList.toggle('spent', i < LOOK.boltShots - bolts));
    lastPw.bolts = bolts;
  }
}

// "+ SHUNT" in the item's hue, over the slots.
export function powerToast(kind) {
  if (!live()) return;
  const el = $('toast');
  el.textContent = `+ ${String(kind).toUpperCase()}`;
  el.style.color = ITEM_COLORS[kind] ?? '';
  flash(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none', offset: 0.15 }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'translateY(-6px)' }], LOOK.toastMs);
}

// powerups: the pad cue chip. state '' hides it; 'refill' shows the next
// item and "REFILLING 12s" (m:ss from a minute); 'full' "INVENTORY FULL ·
// Q TO USE". Called every frame; the DOM is written only on a change.
const lastCue = { state: '', kind: '', secs: -1, use: '' };
export function padCue(state, kind, secs) {
  const el = $('padcue');
  if (!live() || !el) return;
  const useCode = keys.use ?? keys.usePowerup ?? 'KeyQ';
  if (state === lastCue.state && kind === lastCue.kind && secs === lastCue.secs && useCode === lastCue.use) return;
  Object.assign(lastCue, { state, kind, secs, use: useCode });
  el.hidden = !state;
  el.classList.toggle('full', state === 'full');
  if (state === 'refill') {
    setIcon(el.firstChild, kind);
    el.style.setProperty('--c', ITEM_COLORS[kind] ?? '');
    el.lastChild.textContent = `REFILLING ${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}`;
  } else if (state === 'full') el.lastChild.textContent = `INVENTORY FULL · ${keyName(useCode).toUpperCase()} TO USE`;
}

// powerups: the slots shake when a pad turns you away for a full inventory.
export function padShake() {
  const el = $('powers');
  if (!live() || !el) return;
  const x = (px) => ({ translate: `calc(${px} * var(--u)) 0` });
  flash(el, [x(0), x(-7), x(6), x(-4), x(2), x(0)], 220);
}

// ---- Name tags: tags from characters.nameTags(), [{ id, name, color, x, y, alpha }]. ----
let tagEls = null;
export function renderNameTags(tags) {
  if (!live()) return;
  if (!tagEls) {
    tagEls = Array.from({ length: LOOK.tags }, () => {
      const el = document.createElement('div');
      el.className = 'tag';
      el.append(document.createElement('i'), document.createElement('span'));
      $('tags').append(el);
      return { el, id: null, name: '', color: '', x: NaN, y: NaN, alpha: 0, seen: false };
    });
  }
  for (const t of tagEls) t.seen = false;
  const n = Math.min(tags?.length ?? 0, LOOK.tags);
  for (let k = 0; k < n; k++) {
    const tag = tags[k];
    const t = freeTag(tag.id);
    t.seen = true;
    t.id = tag.id;
    if (tag.name !== t.name) t.el.lastChild.textContent = t.name = tag.name;
    if (tag.color !== t.color) t.el.firstChild.style.background = t.color = tag.color;
    const x = Math.round(tag.x);
    const y = Math.round(tag.y);
    if (x !== t.x || y !== t.y) {
      t.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      t.x = x;
      t.y = y;
    }
    const alpha = Math.round((tag.alpha ?? 1) * 20) / 20;
    if (alpha !== t.alpha) t.el.style.opacity = t.alpha = alpha;
  }
  for (const t of tagEls) if (!t.seen && t.alpha !== 0) t.el.style.opacity = t.alpha = 0;
}

// The element already showing this id, else a hidden one, else any unused.
function freeTag(id) {
  let spare = null;
  for (const t of tagEls) {
    if (t.seen) continue;
    if (t.id === id) return t;
    if (!spare || (t.alpha === 0 && spare.alpha !== 0)) spare = t;
  }
  return spare;
}

// ---- Threats: shock = seconds until the first dome strikes, or null;
// shunts = rockets locked on you, as screen angles (radians clockwise from
// straight ahead), or as [x, y, z] positions seen from `eye` ({ x, z }) at `yaw`.
let lastShock = null;
const shuntAngles = [null, null, null, null];
export function threat(t, eye = null, yaw = 0) {
  if (!live()) return;
  const shock = t?.shock ?? null;
  const shunts = t?.shunts ?? NO_ITEMS;
  const on = shock !== null;
  if (on !== lastShock) {
    const el = $('threat-shock');
    if (on && !el.firstChild) el.append(icon('shock'), 'SHOCK INBOUND');
    el.hidden = !on;
    lastShock = on;
  }
  const chevrons = $('threat-shunts').children;
  for (let i = 0; i < chevrons.length; i++) {
    const el = chevrons[i];
    const s = shunts[i];
    const a = s === undefined ? null : Math.round((typeof s === 'number' ? s : bearing(s, eye, yaw)) * 100) / 100;
    if (a === shuntAngles[i]) continue;
    shuntAngles[i] = a;
    if (a === null) { el.className = ''; continue; }
    if (!el.firstChild) el.innerHTML = CHEVRON;
    el.className = 'on';
    el.style.transform = `rotate(${a}rad) translateY(calc(-${LOOK.shuntRing} * var(--u)))`;
  }
}

// Radians clockwise from straight ahead to the point p = [x, y, z].
export function bearing(p, eye, yaw) {
  const dx = p[0] - (eye?.x ?? 0);
  const dz = p[2] - (eye?.z ?? 0);
  return Math.atan2(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw));
}

// players: the lobby list. over: { winner, secondsLeft } once a match ends.
// main.js replaces lobby.players on every lobby message, so the same array
// means the same rows: rebuild only when it (or who you are) changes.
let sbPlayers = null;
let sbMe = null;
export function renderScoreboard(players, myId, over) {
  if (!live()) return;
  if (players !== sbPlayers || myId !== sbMe) sbRows(players, myId);
  setText('sb-title', over ? (over.winner ? `${over.winner} wins` : 'Match over') : 'Scoreboard');
  setText('sb-sub', over ? `Next match in ${Math.max(0, Math.ceil(over.secondsLeft))} s` : '');
}

function sbRows(players, myId) {
  sbPlayers = players;
  sbMe = myId;
  const ranked = [...players].sort(byScore);
  $('sb-rows').replaceChildren(...ranked.map((p, i) => {
    const tr = document.createElement('tr');
    if (p.id === myId) tr.className = 'me';
    else if (!p.connected) tr.className = 'gone';
    const cell = (text, cls) => {
      const td = document.createElement('td');
      td.className = cls ?? '';
      td.textContent = text;
      tr.append(td);
      return td;
    };
    const rank = cell(i + 1, 'r');
    if (i === 0 && p.kills > 0) rank.insertAdjacentHTML('afterbegin', `<span class="crown">${CROWN}</span>`);
    const swatch = Object.assign(document.createElement('span'), { className: 'swatch' });
    swatch.style.background = PLAYER_COLORS[p.slot] ?? '';
    cell('', 's').append(swatch);
    cell(p.name, 'l');
    for (const text of [p.kills, p.deaths, p.pk ?? 0, !p.connected ? 'left' : p.bot ? 'bot' : `${p.ping} ms`]) cell(text);
    return tr;
  }));
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

// The host's map would not load: say so where the lobby status goes.
let loadFailed = false;
export function showLoadError(on) {
  loadFailed = on;
  if (on) $('lobby-status').textContent = 'Could not load the map from the host. Retrying…';
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
  // Your slot colour marks your own panels.
  const me = m.players.find((p) => p.id === myId);
  if (me) $('hud').style.setProperty('--me', PLAYER_COLORS[me.slot]);
  const isHost = m.host === myId;
  $('start').hidden = !(isHost && m.phase === 'lobby');
  if (!loadFailed) $('lobby-status').textContent = m.phase === 'lobby' ? (isHost ? '' : 'Waiting for host…') : 'Match in progress.';
  $('scoreboard').classList.toggle('over', m.phase === 'scoreboard');
  renderMaps(m, myId);
}

// ---- Map vote cards, the same in the lobby card and on the scoreboard.
// The buttons are made once per map list and filled in place, so a vote
// arriving mid-press never swallows a click and keyboard focus stays put
// (their children take no pointer events, so the button is the target). ----
let mapsKey = '';
let mapIds = '';
function renderMaps(m, myId) {
  const slots = new Map(m.players.map((p) => [p.id, p.slot]));
  const cards = (m.maps ?? []).map((c) => ({
    id: c.id, name: c.name ?? c.id, tagline: c.tagline ?? '', votes: c.votes,
    pips: c.voters.map((id) => PLAYER_COLORS[slots.get(id)] ?? 'var(--dim)'),
    mine: c.voters.includes(myId),
    now: c.id === m.map ? (m.phase === 'lobby' ? 'Current' : 'Now playing') : '',
  }));
  const key = JSON.stringify(cards);
  if (key === mapsKey) return;
  mapsKey = key;
  const ids = cards.map((c) => c.id).join();
  for (const id of ['lobby-maps', 'sb-maps']) {
    const box = $(id);
    if (ids !== mapIds) box.replaceChildren(...cards.map(() => Object.assign(document.createElement('button'), { type: 'button' })));
    cards.forEach((c, i) => fillCard(box.children[i], c, i));
  }
  mapIds = ids;
}

function fillCard(card, c, i) {
  const el = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
  card.className = c.mine ? 'mapcard mine' : 'mapcard';
  card.dataset.map = c.id;
  card.setAttribute('aria-pressed', c.mine);
  const top = el('span', 'mc-top');
  top.append(el('span', 'key', i + 1), el('span', 'mc-name', c.name), el('span', c.votes ? 'mc-count some' : 'mc-count', c.votes));
  const pips = el('span', 'mc-pips');
  for (const color of c.pips) {
    const pip = el('i', '');
    pip.style.setProperty('--c', color);
    pips.append(pip);
  }
  const flags = el('span', 'mc-flags');
  if (c.now) flags.append(el('span', '', c.now));
  if (c.mine) flags.append(el('span', 'you', 'Your vote'));
  card.replaceChildren(top, el('span', 'mc-tag', c.tagline), pips, flags);
}

// fn(mapId) when a card is clicked.
export function onVote(fn) {
  for (const id of ['lobby-maps', 'sb-maps']) {
    $(id).addEventListener('click', (e) => {
      const card = e.target.closest('[data-map]');
      if (card) fn(card.dataset.map);
    });
  }
}

// ---- ?debug&hud=demo: every element with demo data, over the live game. ----
const DEMO_BOARD = [
  [4, 'bot4', 17, 6, 4, 8], [1, 'bot1', 14, 9, 2, 12], [3, 'Tester', 12, 7, 3, 3], [2, 'bot2', 9, 11, 1, 9],
  [6, 'bot6', 8, 10, 0, 15], [5, 'bot5', 6, 12, 2, 11], [7, 'bot7', 4, 13, 1, 7], [8, 'bot8', 2, 14, 0, 18],
].map(([id, name, kills, deaths, pk, ping]) => ({ id, name, kills, deaths, pk, ping, slot: id - 1, connected: true, bot: false }));
function startDemo() {
  const run = (fn) => { demoing = true; try { fn(); } finally { demoing = false; } };
  run(() => {
    if (DEMO === 'death') {
      showDeath('bot4', 3, { color: PLAYER_COLORS[3], weapon: 'rifle', killerHp: 64 });
      showPicker(true);
    }
    updateHud(64, 'rifle', 17, false, { maxMag: 25, shield: 30, shieldSeconds: 5.2, nitro: 2.6 });
    updatePowers({ inv: ['shunt', 'bolt', 'shield'], sel: 1, cd: 24, bolts: 0 });
    updateMatchInfo(287, { name: 'bot4', kills: 17, slot: 3 }, { rank: 3, of: 8 });
    renderNameTags([
      { id: 1, name: 'bot1', color: PLAYER_COLORS[0], x: innerWidth * 0.3, y: innerHeight * 0.44, alpha: 1 },
      { id: 2, name: 'bot5', color: PLAYER_COLORS[4], x: innerWidth * 0.72, y: innerHeight * 0.46, alpha: 1 },
      { id: 3, name: 'bot2', color: PLAYER_COLORS[1], x: innerWidth * 0.56, y: innerHeight * 0.42, alpha: 0.6 },
    ]);
    if (DEMO !== 'death') threat({ shock: 1.2, shunts: [1.35, -0.9] }); // keeps the death card clear
    renderScoreboard(DEMO_BOARD, 3, null);
    // arsenal: ?debug&hud=feed shows the five guns the demo feed leaves out.
    const feed = DEMO === 'feed' ? [
      ['bot1', 'bot4', 'marksman', true, false, 0, 3], ['Tester', 'bot2', 'burst', false, true, 2, 1], ['bot6', 'bot5', 'machinepistol', false, false, 5, 4],
      ['bot5', 'Tester', 'rifle', false, true, 4, 2], ['bot2', 'bot1', 'smg', false, false, 1, 0],
    ] : [
      ['bot1', 'bot4', 'sniper', true, false, 0, 3], ['Tester', 'bot2', 'shunt', false, true, 2, 1], ['bot6', 'bot5', 'lmg', false, false, 5, 4],
      ['bot5', 'Tester', 'handcannon', true, true, 4, 2], ['bot2', 'bot1', 'shotgun', false, false, 1, 0],
    ];
    $('killfeed').classList.add('demo'); // rows stay
    for (const [k, v, w, h, mine, kc, vc] of feed) addKill(k, v, w, h, mine, { killer: PLAYER_COLORS[kc], victim: PLAYER_COLORS[vc] });
    hitMarker(true);
    if (DEMO !== 'death') killConfirm('bot2', PLAYER_COLORS[1]);
    damageArc(-2.2);
    powerToast('shunt');
    if (DEMO === 'demo') padCue('refill', 'shunt', 12); // powerups:
    if (DEMO === 'full') padCue('full', '', 0); // powerups:
  });
}
