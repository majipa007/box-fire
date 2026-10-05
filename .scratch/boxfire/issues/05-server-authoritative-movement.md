# 05: Server-authoritative movement

**What to build:** The host decides movement. The client sends a 60 Hz input stream, and the server ticks at 60 Hz and sends a snapshot every tick. The client predicts and reconciles, so movement still feels instant.

**Blocked by:** 04

**Status:** done

- [x] Each input packet carries seq, render tick, keys, yaw, pitch, fire, shot number and weapon slot.
- [x] The server tick loop uses an hrtime accumulator, caps catch-up at 5 ticks, and logs tick intervals every 10 s.
- [x] Every snapshot carries the tick, the last acked seq, every player's public state, and the receiving player's full own state.
- [x] The client reconciles: it snaps to the server state, drops acked inputs, and replays the rest. It never reconciles its own yaw or pitch.
- [x] A client whose socket buffer is backed up gets no new snapshots until it drains.
