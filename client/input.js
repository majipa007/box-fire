// Pointer lock, mouse look and keys. The camera turns on every mouse event;
// the fixed 60 Hz step only samples it.
import { KEY } from '../shared/movement.js';

export const look = { yaw: 0, pitch: 0 };

// KeyboardEvent.code per action. Rebinding edits this map.
export const bindings = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', walk: 'ShiftLeft', crouch: 'KeyC', reload: 'KeyR',
};
const BITS = {
  forward: KEY.FORWARD, back: KEY.BACK, left: KEY.LEFT, right: KEY.RIGHT,
  jump: KEY.JUMP, walk: KEY.WALK, crouch: KEY.CROUCH, reload: KEY.RELOAD,
};
// Press-once actions are latched until the next sample, so a tap shorter
// than one step still counts.
const EDGES = KEY.JUMP | KEY.RELOAD;

const PITCH_LIMIT = (89 * Math.PI) / 180;
let radiansPerPixel = 0.002;
let held = 0;
let latched = 0;
let locked = false;

export const setSensitivity = (s) => { radiansPerPixel = s * 0.001; };

function bitFor(code) {
  for (const action in bindings) if (bindings[action] === code) return BITS[action];
  return 0;
}

export function clearKeys() {
  held = 0;
  latched = 0;
}

export function sample() {
  const keys = (held & ~EDGES) | latched;
  latched = 0;
  return { keys, yaw: look.yaw, pitch: look.pitch };
}

// onNeutral fires when the game loses the keyboard (blur, hidden tab, lost
// pointer lock): keyup never arrives for a background tab, so keys are
// cleared and the caller sends a no-keys packet at once.
export function init(target, { onLockChange, onLockError, onNeutral }) {
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
    const bit = locked && bitFor(e.code);
    if (!bit) return;
    e.preventDefault();
    if (e.repeat) return;
    held |= bit;
    latched |= bit & EDGES;
  });
  addEventListener('keyup', (e) => { held &= ~bitFor(e.code); });
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
