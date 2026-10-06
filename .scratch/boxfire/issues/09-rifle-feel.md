# 09: Rifle feel

**What to build:** Firing looks and feels like a rifle. A box gun model kicks back with each shot, the muzzle flashes, and the camera kicks up more and more over a spray, which you pull down to control. A red arc on the crosshair points toward whoever just hit you.

**Blocked by:** 08

**Status:** done

- [x] The gun model recoils (translates back and rotates up) and eases back over 80 ms. It is drawn in its own pass so it never clips into walls.
- [x] The muzzle flash shows for two frames.
- [x] The camera kick is client-side and climbs over 8 shots.
- [x] The damage-direction arc points toward the attacker.
