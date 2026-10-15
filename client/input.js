// Pointer lock, mouse look and keys. The camera turns on every mouse event;
// the fixed 60 Hz step only samples it.
import { KEY } from '../shared/movement.js';
import { PITCH_LIMIT, PRIMARIES, SECONDARIES } from '../shared/constants.js';

const PICKS = [...PRIMARIES, ...SECONDARIES]; // arsenal: the picker's order (ui.js PICKS)

export const look = { yaw: 0, pitch: 0 };

// KeyboardEvent.code per action. Rebinding edits this map.
export const bindings = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', walk: 'ShiftLeft', crouch: 'KeyC', reload: 'KeyR',
  primary: 'Digit1', pistol: 'Digit2', picker: 'KeyB', scoreboard: 'Tab',
  use: 'KeyQ', cycle: 'KeyE', // POWER-UPS: use the selected item, select the next
};
const SLOTS = { primary: 0, pistol: 1 };
const BITS = {
  forward: KEY.FORWARD, back: KEY.BACK, left: KEY.LEFT, right: KEY.RIGHT,
  jump: KEY.JUMP, walk: KEY.WALK, crouch: KEY.CROUCH, reload: KEY.RELOAD,
  use: KEY.USE, cycle: KEY.CYCLE, // POWER-UPS: press-once bits
};
// Press-once actions are latched until the next sample, so a tap shorter
// than one step still counts.
const EDGES = KEY.JUMP | KEY.RELOAD | KEY.USE | KEY.CYCLE; // POWER-UPS: one use or cycle per press

let radiansPerPixel = 0.002;
let held = 0;
let latched = 0;
let fireHeld = false;
let fireLatched = false; // a click shorter than one step still fires
let slot = 0; // weapon slot asked for: 0 primary, 1 pistol
let locked = false;

export const setSlot = (s) => { slot = s; };

export const setSensitivity = (s) => { radiansPerPixel = s * 0.001; };

function bitFor(code) {
  for (const action in bindings) if (bindings[action] === code) return BITS[action];
  return 0;
}

export function clearKeys() {
  held = 0;
  latched = 0;
  fireHeld = false;
  fireLatched = false;
}

export function sample() {
  const keys = (held & ~EDGES) | latched;
  const fire = fireHeld || fireLatched;
  latched = 0;
  fireLatched = false;
  return { keys, yaw: look.yaw, pitch: look.pitch, fire, slot };
}

// onNeutral fires when the game loses the keyboard (blur, hidden tab, lost
// pointer lock): keyup never arrives for a background tab, so keys are
// cleared and the caller sends a no-keys packet at once.
// While the loadout picker is open, the digits choose a gun instead of a slot.
export function init(target, { onLockChange, onLockError, onNeutral, onPicker, pickerOpen, onScoreboard }) {
  const neutral = () => {
    clearKeys();
    onNeutral();
  };
  addEventListener('mousemove', (e) => {
    if (!locked) return;
    // Chrome on Windows occasionally reports a huge bogus jump under pointer lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    look.yaw -= e.movementX * radiansPerPixel;
    look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch - e.movementY * radiansPerPixel));
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault(); // keep focus on the game
    if (e.code === bindings.scoreboard) {
      e.preventDefault();
      onScoreboard(true);
    }
    if (locked && e.code === bindings.picker && !e.repeat) onPicker(null);
    // arsenal: while the picker is open the digits pick from it (1 → first
    // primary, 2 → second, … sidearms after the primaries, 0 the tenth).
    const digit = /^Digit(\d)$/.exec(e.code)?.[1];
    if (locked && digit && pickerOpen()) {
      const id = PICKS[(Number(digit) + 9) % 10];
      if (id && !e.repeat) onPicker(id);
    } else {
      for (const action in SLOTS) if (locked && bindings[action] === e.code) slot = SLOTS[action];
    }
    const bit = locked && bitFor(e.code);
    if (!bit) return;
    e.preventDefault();
    if (e.repeat) return;
    held |= bit;
    latched |= bit & EDGES;
  });
  addEventListener('keyup', (e) => {
    held &= ~bitFor(e.code);
    if (e.code === bindings.scoreboard) onScoreboard(false);
  });
  addEventListener('mousedown', (e) => {
    if (!locked || e.button !== 0) return;
    fireHeld = true;
    fireLatched = true;
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) fireHeld = false; });
  addEventListener('wheel', (e) => { if (locked && e.deltaY) slot = 1 - slot; });
  addEventListener('blur', neutral);
  document.addEventListener('visibilitychange', () => { if (document.hidden) neutral(); });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === target;
    if (!locked) neutral();
    onLockChange(locked);
  });
  document.addEventListener('pointerlockerror', onLockError);
}

// Unadjusted movement turns off OS mouse acceleration where supported.
// A failed lock also fires pointerlockerror, which the caller handles.
export async function requestLock(target) {
  try {
    await target.requestPointerLock({ unadjustedMovement: true });
  } catch (err) {
    if (err?.name === 'NotSupportedError') await target.requestPointerLock()?.catch?.(() => {});
  }
}
