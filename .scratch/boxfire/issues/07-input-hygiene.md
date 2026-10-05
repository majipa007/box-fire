# 07: Input hygiene

**What to build:** Network hiccups and alt-tab don't break movement. If you alt-tab while holding W, you stop. A stalled client resumes without teleporting.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] The jitter buffer depth is a constant.
- [ ] Late inputs are dropped, but the acked seq still advances.
- [ ] At most two inputs are applied per tick, and the oldest is dropped beyond a maximum queue depth.
- [ ] An empty tick repeats only movement and look. Fire and press edges are never repeated.
- [ ] After 250 ms without input the player goes neutral. The next input re-syncs the queue.
- [ ] The client clears its keys and sends a neutral packet on window blur, tab hide and pointer-lock loss.
- [ ] Tests cover the queue rules.
