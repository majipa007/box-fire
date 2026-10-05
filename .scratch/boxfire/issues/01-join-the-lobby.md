# 01: Join the lobby

**What to build:** The host runs `npm start` and the terminal prints a URL for every LAN address. A friend opens one, types a display name and lands in a lobby. The lobby lists every connected player with their ping and colour, and updates live. The host sees Start; everyone else sees "waiting for host". Start moves everyone into the match phase.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The server serves the client at `/` and the shared modules at `/shared/` with correct MIME types. Any path that resolves outside those two folders gets a 404.
- [ ] The terminal prints one URL per LAN IPv4 address.
- [ ] Names are trimmed, 1–16 characters long and unique ignoring case. A taken name is rejected with a message. Names are rendered as text, never as HTML.
- [ ] The lobby shows each player's name, heartbeat ping and colour. It updates on join and leave, and pings refresh every second.
- [ ] The host is the loopback connection; if none is connected, the longest-connected player. Bots are never host. The role passes on when the host leaves.
- [ ] Malformed JSON, non-finite numbers and oversized messages are dropped without crashing the host.
- [ ] The server logs ids and counts only, never names.
