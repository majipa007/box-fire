# 03: Run, jump and collide

**What to build:** In the arena you run with WASD, jump with Space and fall under gravity. You slide along walls without clipping through them. Movement steps at a fixed 60 Hz and renders smoothly at any refresh rate.

**Blocked by:** 02

**Status:** done

- [x] The shared movement step has: run at 5.5 m/s, jump of about 1 m, gravity of 20 m/s², 20 % air control, and no speed gain from air strafing.
- [x] Collision against the map boxes is swept on each axis. Nothing tunnels through, even at maximum fall speed.
- [x] A jump press is latched between samples, so a quick tap still jumps.
- [x] A 0.75 m ledge can be jumped onto. The 1.2 m platform cannot be jumped onto directly, but can be reached over the 0.6 m crate.
- [x] Your own player renders interpolated between the last two fixed steps.
- [x] Movement and collision have tests.
