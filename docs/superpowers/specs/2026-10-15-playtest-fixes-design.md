# Playtest fixes: weapon balance, power-up readability, bot AI

Date: 15/10/2026. Status: awaiting the user's review.

The designs come from an evidence workflow. For each area, an investigator measured today's game, two designers proposed fixes from different angles, and an adversarial judge re-checked the numbers and merged the designs. A final review checked how the areas interact. The raw results are in `boxfire-work/tmp/gp-design.json`, and the scripts that produced each number are in `boxfire-work/tmp/gp-*`.

## What the user reported (playtest, 15/10/2026)

1. "An assault rifle can kill an enemy with just 3–4 bullets at long range, while a shotgun takes 2 or more shots even at close range."
2. "I thought I had collected a power-up, only to realize it was still on a countdown timer."
3. "The bot AI is terrible."

## Decisions the user made

| Question | Decision |
|---|---|
| Rifle headshots | Every headshot does 160 at any range, mid-spray too (pure Vandal) |
| Rifle body hits | 4 hits to kill, up from 3 |
| Pad refill in small games | Stretch capped at 3× (60–90 s with 1 player, not 2–3 min) |
| Default bot difficulty | Mixed: each bot rolls easy, normal or hard |

## 1. Weapon balance

**Causes, as measured.**
- The rifle did 40 per body hit with no falloff and 0.4° first-shot spread, so it killed in 3 hits at every range.
- The shotgun's 12 pellets of 8 damage maxed at 96, below 100 HP. With pellets lost to the cone, it never one-shot.

**Numbers** (`shared/constants.js` WEAPONS). Fire rate, magazine and reload are unchanged on every weapon.

| Weapon | Change |
|---|---|
| Rifle | dmg 40 → 30; head mult 3 (used only if headDmg is unset); **headDmg 160**, flat at any range on every bullet; spreadStand 0.4 → 0.15; falloff 20 m → 30 m down to 0.8 (body 30 → 24); bloom 0.25° per heat, cool 4 heat/s, bloomMax 2° |
| Shotgun | pellet dmg 8 → 10 (120 max: kills 100 HP, not a Shield's 160 on body); spread 4° → 3.5°; falloff 8 m → 18 m down to 0.2 |
| Pistol | adds falloff 25 m → 40 m down to 0.75; unchanged up close |

**Spray heat (a new mechanic, shared and predicted).**
- The arsenal gains `heat`. Each shot adds 1, capped so bloom tops out at bloomMax. Heat cools at `cool` per second and clears on a weapon switch.
- `shotHeat(a)` is the heat before the current shot, so the first shot fires with zero bloom.
- Spread adds `bloom × heat`. Server and client both pass `shotHeat` into `shotDirs`, so the seeded spread still matches.
- Heat travels in the existing `me.arsenal` snapshot, so there is no protocol change.
- The crosshair gap reads the real heat.

**Server `fire()`.**
- Damage per victim is summed and rounded, so HP always shows whole numbers.
- A shotgun blast counts as a headshot only when most of its landed pellets hit the head.

**What the player gets.**
- Rifle: a headshot kills at any range, through a Shield. Body hits take 4 (300 ms) out to about 29 m, then 5.
- Rifle sprays: holding the trigger at range opens the crosshair, and later shots scatter.
- Shotgun: a chest-high blast kills within about 6 m, is a coin flip at 8 m, and is useless past 16 m.

**Accepted risk (the user chose it).** With a flat 160 on every bullet, a lazy chest spray at 30–40 m kills in 2 bullets about 20–40% of the time, when kick climb rolls a bullet into the head. Bloom limits it.

## 2. Power-up readability

**Causes, as measured.**
- A refilling pad still showed its item hologram and a dim beam.
- Another player's pickup played the same chime as your own, at near full volume.

**Rule: a beam and a full item glyph mean an item is on the pad. Anything else means it is empty.**

- **The pad's state comes from the server:** up means `!pad.ready`, never the client clock.
- **A refilling pad shows:**
  - no glyph, no hologram and no beam;
  - a standing clock at glyph height, facing the camera, filling clockwise in the next item's hue, with the whole seconds left drawn in voxel digits (never 0 while waiting for the server);
  - a matching clock ring on the floor in place of the pool;
  - a dimmed plinth;
  - in the last 3 s, the digits turn the item's hue and the clock pulses, instead of the beam flickering.
- **When an item comes back,** the beam shoots up over 220 ms and the glyph springs in (0 → 1.2 → 1). This is visual only.
- **When an item is taken,** the glyph collapses over 150 ms, then the clock appears.
- **Your own pickup** gets the burst, the chime and the toast. Someone else's gets a quiet "taken" sound (−20 dB) and the collapse.
- **A pad cue for each pickup attempt** uses a shared, allocation-free `padUnder(mover, pads)` helper:
  - standing on an empty pad shows "REFILLING 12s" (m:ss past 60 s), with an "empty" sound;
  - standing on a pad with 3 items shows "INVENTORY FULL", with its own sound and a shake of the slots.
- **The refill stretch** becomes `min(3, POWER_RATE_PLAYERS / n)` (`shared/powerups.js` `padRespawnTicks`).
- **Budget:** no protocol change; still 6 instanced draws; worst case about 6.5k triangles against the bible's 9k cap; nothing allocated per frame.

## 3. Bot AI

**Cause, as measured.** Today's bots never fire a gun (`fire: false` is hard-coded). Every kill they make is with a power-up, and an idle player dies 0 times a minute.

**Design: a lightweight utility AI with A\* navigation.** Bots stay separate WebSocket clients that send normal inputs. Nothing changes on the server or in the shared simulation.

- **Files:** `tools/bot.js` is the entry point (CLI, sockets, one 60 Hz input per bot), plus pure modules `tools/bot/nav.js`, `aim.js` and `brain.js`, each with tests.
- **Navigation:**
  - a 0.5 m height grid built from the map's boxes, inflated by half the player width plus a 5 cm skin;
  - 8-connected A\* with no corner cutting, steps up to 0.9 m and any drop;
  - expansions capped at 3000, and at most 3 plans per timer tick;
  - replanning on a goal change, every 0.5 s, or when a bot is 1.5 m off its path;
  - stuck handling: hop after 4 ticks, drop the goal after 60;
  - navigation is cached per map id (ids checked against `MAPS`) and rebuilt when the map changes.
- **Perception (no wallhacks):**
  - enemies inside the field of view or a notice radius, with a clear line of sight;
  - gunshots heard with position noise that grows with distance;
  - hits felt as a rough bearing.
- **Aim:**
  - sees its target with reaction lag and partial lead;
  - a flick error on acquiring, settling over time, plus wobble that grows with its own speed;
  - a turn-rate cap;
  - rolls head or chest once per target;
  - fires only when its aim error and current spread fit the target.
- **Brain (5 Hz, staggered by bot, with hysteresis):** it scores and picks a goal:
  - fight;
  - take cover when hurt or empty;
  - hunt the last enemy seen or heard;
  - collect a pad, after 2–8 s of patience;
  - roam.
  Fight movement goes through navigation, with strafing on top.
- **Weapon roles come from each gun's numbers,** so the coming roster needs no code per gun:
  - pellets mean close range;
  - slow semi-auto means precision, stopping to shoot;
  - auto means bursts;
  - other semi-auto weapons click at their fire rate.
  The ideal range comes from falloff. Bots switch to the pistol when the primary is empty, reload below 40% with no enemy around, and never shoot a shielded player.
- **Difficulty:** `--skill easy|normal|hard|mixed`, default **mixed**. Each skill sets reaction time, aim error, head chance, field of view and turn rate.
- **Prototype measurements** (6 bots, live): 42% hit rate, 0.35 s median reaction, an idle player dying about 6 times a minute, and 0.2–0.6 ms of CPU per tick. Navigation reached all 420 trips on arena_01 and all 506 on arena_02.

## Build plan

The order comes from the cross-area review.

1. **Ticket 20 merges to main first.** It adds `setPads`/`setMap`, `lobby.map` and the bots' map handling, which the power-up and bot work build on.
2. **Weapons workstream.** It lands the shared contract in one commit: the new WEAPONS keys, `heat`, `shotHeat`, and trailing `heat = 0` parameters on `spreadDegrees`, `shotDirs` and `damageAt`. It updates the tests, the plan (lines 105–109, 119) and the bible.
3. **Power-up workstream,** built in parallel with weapons and merged after it. It owns `client/powerups.js`, `padUnder` in `shared/powerups.js`, the cue chip in `ui.js`/`index.html`, its sounds, and one line in `main.js`.
4. **Bot workstream,** last, because its aim tests and ideal ranges use the merged weapon numbers. Its live runs are also the first automated check of weapon balance and power-up use.
5. **Joint pass:**
   - rerun the bot live gates and the power-up smokes on the merged build;
   - check the power-up kill share is at most 25%;
   - check shotgun bots score at least 0.6× rifle bots' kills per life (fix bot approach first; change weapon numbers only after a human playtest).

Each workstream is critiqued adversarially and fixed before it merges, and every check runs before each commit.

## Verification

- Unit tests:
  - falloff and headDmg at range;
  - heat: first shot zero, cap, cooling, switch clear, and prediction parity between two arsenals;
  - `padUnder` across every map;
  - navigation reachability on every map;
  - aim error bands;
  - goal selection.
- Live:
  - the Monte Carlo kill tables rerun on the merged constants;
  - power-up stills of every pad state, plus a smoke steps file that walks onto empty and full pads;
  - bot metrics over 60 s per skill: hit rate, reaction, stuck time, kills per minute, idle-player deaths;
  - browser stills of bots fighting.

## Out of scope (parked)

- The gun roster and registry: approach A, one file per gun in `shared/guns/`, still awaits the user's approval. Burst and scope keys are defined there.
- Adding bots from the in-game lobby or the single-file exe.
- Building the scene before joining, to stop slow software-rendered joiners from timing out (found in ticket 20).
