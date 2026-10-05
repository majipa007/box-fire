# 12: Clicks survive dropped inputs

**What to build:** A click is never lost to a network hiccup. If an input is dropped, its fire press still fires on the next applied input.

**Blocked by:** 07, 10, 11

**Status:** ready-for-agent

- [ ] A dropped input's fire press carries into the next applied input, along with its shot number and render tick.
- [ ] The cooldown still gates every shot.
- [ ] A test with dropped inputs shows the press still fires.
