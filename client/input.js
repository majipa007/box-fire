// Pointer lock and mouse look. The camera turns on every mouse event; the
// 60 Hz input packets only sample it.
export const look = { yaw: 0, pitch: 0 };

const PITCH_LIMIT = (89 * Math.PI) / 180;
let radiansPerPixel = 0.002;

export const setSensitivity = (s) => { radiansPerPixel = s * 0.001; };

export function init(target, { onLockChange, onLockError }) {
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== target) return;
    // Chrome on Windows occasionally reports a huge bogus jump under pointer lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    look.yaw -= e.movementX * radiansPerPixel;
    look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch - e.movementY * radiansPerPixel));
  });
  document.addEventListener('pointerlockchange', () => onLockChange(document.pointerLockElement === target));
  document.addEventListener('pointerlockerror', onLockError);
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab') e.preventDefault(); // keep focus on the game
  });
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
