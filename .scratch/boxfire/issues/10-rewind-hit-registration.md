# 10: Rewind hit registration

**What to build:** Shots are judged against what the shooter saw. If your crosshair is on a strafing player's head when you click, it's a headshot.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] The server keeps 1 s of hitbox history and blends between stored ticks for a fractional render tick.
- [ ] Every input carries the render tick. It is clamped so the history can never be read out of range.
- [ ] The history lookup has tests.
