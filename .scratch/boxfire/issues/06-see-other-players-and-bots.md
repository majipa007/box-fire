# 06: See other players, plus bots

**What to build:** Other players appear as box figures tinted with their slot colour, with name tags and swinging legs, and they move smoothly. A bot command adds bots that strafe and jump. Bots go through the real input pipeline, so they exercise the same path as players.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Other players are interpolated a configurable number of ticks behind. When snapshots run dry they freeze rather than extrapolate.
- [ ] Crouched players render shorter, and legs swing with movement speed.
- [ ] Players pass through each other.
- [ ] `npm run bot -- --count N` joins N bots. Bots never become host.
