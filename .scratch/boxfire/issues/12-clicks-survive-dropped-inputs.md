# 12: Clicks survive dropped inputs

**What to build:** A click is never lost when a long stall overflows the server's input queue. If an input is dropped by overflow, its fire press still fires on the next applied input.

**Blocked by:** 07, 10, 11

**Status:** ready-for-agent

Since ticket 07, inputs are only ever dropped by queue overflow; nothing is dropped for being late.

- [ ] An overflow-dropped input's fire press carries into the next applied input, along with its shot number and render tick.
- [ ] The cooldown still gates every shot.
- [ ] A test with an overflowing burst shows the press still fires.
