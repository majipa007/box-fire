# 04: Walk and crouch

**What to build:** Shift walks at 2.7 m/s. C crouches: you move at 1.8 m/s and your eye height drops from 1.6 m to 1.1 m. Crouching shrinks your collider from the top, in the air as well, so there's no crouch-jump. You cannot stand up while something is above your head.

**Blocked by:** 03

**Status:** done

- [x] Walk and crouch speeds apply on the ground.
- [x] The crouched collider is 1.2 m tall and its feet stay put, including in the air.
- [x] Standing up is blocked under a ceiling, and you stay crouched until there is room.
- [x] Tests cover the crouch collider, a blocked uncrouch, and both speeds.
