# 20: Second map

**What to build:** A second arena. A map is pure data, so this is mostly a new map file plus a way to choose which map is played.

**Blocked by:** 15

**Status:** done on 15/10/2026. The second map is Weighbridge (`shared/maps/arena_02.json`). Players vote for the map in the lobby and on the scoreboard (decided 13/10/2026; see the plan, after the v1 map paragraph).

- [x] Decision recorded in the plan.
- [x] Lobby and scoreboard show a card per map with live vote tallies; a player can change their vote.
- [x] The winner follows the plan's rules: most votes, then the host's pick, then list order, and no votes keeps the current map.
- [x] The second map is playable end to end, including a late joiner and a rejoin by name mid-match. (Verified live on Weighbridge after the merge: steps20 switches both ways, and a late joiner and a rejoin land on it.)
