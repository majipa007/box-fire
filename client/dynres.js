// Dynamic resolution (docs/bible.md §7): drop the render scale when frames run
// long, creep back up when they stay short. Pure, so Node can test it.
const SLOW_MS = 17.5; // a frame over this misses 60 fps
const WINDOW = 60; // frames looked back over
const SLOW_FRAMES = 20; // slow frames in the window that force a drop
const DOWN = 0.1;
const UP = 0.05;
const QUIET_MS = 10000; // no slow frame for this long before a step up
const HOLD_MS = 30000; // after dropping from X, stay below X this long
const GAP_MS = 2000; // between changes: setPixelRatio reallocates

// frame(ms, now, scale, max, floor) → the new scale, or null to keep it.
// max is the user's setting; floor is 0.6 on Default, 0.5 on Low.
export function createDynres() {
  const slow = new Uint8Array(WINDOW);
  let at = 0;
  let count = 0;
  let quietSince = -Infinity; // set by the first frame
  let changedAt = -Infinity;
  let droppedFrom = Infinity;
  let droppedAt = -Infinity;
  return function frame(ms, now, scale, max, floor) {
    const s = ms > SLOW_MS ? 1 : 0;
    count += s - slow[at];
    slow[at] = s;
    at = (at + 1) % WINDOW;
    if (s || quietSince === -Infinity) quietSince = now;
    if (now - changedAt < GAP_MS) return null;
    let next = null;
    if (count >= SLOW_FRAMES && scale > floor + 1e-6) {
      next = Math.max(floor, scale - DOWN);
      droppedFrom = scale;
      droppedAt = now;
    } else if (now - quietSince >= QUIET_MS && scale < max - 1e-6) {
      const cap = now - droppedAt < HOLD_MS ? Math.min(max, droppedFrom - UP) : max;
      if (scale + UP <= cap + 1e-6) next = scale + UP;
    }
    if (next === null) return null;
    changedAt = now;
    quietSince = now; // the next step up waits another 10 s
    slow.fill(0); // a fresh window at the new scale
    count = 0;
    return Math.round(next * 100) / 100;
  };
}
