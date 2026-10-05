# 11: Seeded spread

**What to build:** Bullet spread is random, but client and server roll the same numbers, so the tracer you see always matches where the server says the bullet went. Moving, jumping and crouching change accuracy.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] A server seed is sent in `welcome`, and every shot carries a shot number.
- [ ] Client and server use the same seeded PRNG. The tracer uses the packet's yaw and pitch.
- [ ] Spread blends from the standing value to the moving value by speed ÷ run speed. It is 2× the moving value when airborne and 0.8× the standing value when crouched.
- [ ] The same seed gives the same spread in tests.
