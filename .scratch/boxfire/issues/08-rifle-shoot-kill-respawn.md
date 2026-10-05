# 08: Rifle: shoot, kill, respawn

**What to build:** Left mouse fires the rifle. Hits are decided by the server, and the shooter gets a hit marker and a tracer. HP drops, players die and respawn after 3 s at the spawn furthest from enemies, and kills appear in the kill feed.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Shared weapon state is predicted on the client: a cooldown that carries its remainder and is clamped when not firing, a 25-round magazine, R to reload, and an automatic reload when firing on empty.
- [ ] The server raycasts head first against standing or crouched hitboxes. Walls block shots.
- [ ] The shooter gets a hit marker and a tracer, and others see the shot.
- [ ] HP and death work. Respawn is after 3 s at the spawn point furthest from any enemy, skipping points used in the last 3 s.
- [ ] Kills appear in the kill feed (names inserted as text). The HUD shows HP and ammo.
- [ ] Ray-vs-box and the weapon cooldown and reload have tests.
