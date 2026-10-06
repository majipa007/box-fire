# 16: Rejoin by name

**What to build:** If your tab dies, reopen the URL with the same name and your kills come back.

**Blocked by:** 15

**Status:** done

- [x] Scores are keyed by name, ignoring case.
- [x] A name in use is rejected unless that player has been silent for over 2 s, in which case the newcomer takes the slot over.
- [x] Disconnected players stay greyed out on the scoreboard until the match ends.
- [x] After 30 s with nobody connected, the game returns to the lobby with scores cleared.
