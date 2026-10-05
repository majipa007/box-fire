# 02: See the arena and look around

**What to build:** After Start, every player sees the flat-shaded arena from a spawn point. Click to play locks the pointer, and the mouse looks around. Losing pointer lock (Esc) opens a menu with sensitivity and FOV, which are saved in the browser.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Three.js is vendored, including everything `three.module` imports and BufferGeometryUtils. The page loads with no internet.
- [ ] The arena renders from the map data: one merged mesh per colour, a hemisphere light plus a directional light, and fog in the sky colour. It stays under 300 draw calls.
- [ ] A click-to-play overlay appears. Pointer lock is requested with unadjusted movement, falling back to a plain request. A lock error shows "click again".
- [ ] The menu opens on pointer-lock loss. Sensitivity and FOV persist in localStorage.
- [ ] Tab's default browser action is prevented.
