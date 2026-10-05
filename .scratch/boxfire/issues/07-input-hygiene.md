# 07: Input hygiene

**What to build:** Network hiccups and alt-tab don't break movement. If you alt-tab while holding W, you stop. A stalled client resumes without teleporting.

**Blocked by:** 06

**Status:** done

Decision during implementation (05/10/2026): every input is applied exactly once, in order. There are no repeats on empty ticks and no drops for lateness. Measured with a 20–40 fps client, the original slot rules dropped 260–430 inputs per 10 s.

- [x] The jitter buffer depth is a constant, and it refills after an empty tick.
- [x] An empty tick applies nothing; a delayed input is still applied when it arrives.
- [x] At most two inputs are applied per tick, and the oldest are dropped beyond a maximum queue depth.
- [x] After 250 ms without input the player goes neutral.
- [x] The client clears its keys and sends a neutral packet on window blur, tab hide and pointer-lock loss.
- [x] Tests cover the queue rules.
