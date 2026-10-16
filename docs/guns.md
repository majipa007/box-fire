# Guns

Every gun is one plain data file in `shared/guns/`, listed in `shared/guns/index.js`. The server, the client's prediction, the bots and the balance script all read the same object, so a gun's numbers live in exactly one place. `shared/guns/guns.test.js` checks every file against the rules below.

## The roster

| Slot | id | Name | Class | Mode | Niche |
| --- | --- | --- | --- | --- | --- |
| sidearm | `pistol` | Rivet | pistol | semi | The launch sidearm: accurate at every range, two headshots kill |
| sidearm | `handcannon` | Sledge | handcannon | semi | 2 body hits or 1 headshot kill; slow, kicks hard |
| sidearm | `machinepistol` | Nailer | machinepistol | auto | Sprays up close and falls off fast |
| primary | `rifle` | Mason | rifle | auto | The default. 4 body hits to about 29 m; every headshot a flat 160 |
| primary | `shotgun` | Crusher | shotgun | semi (pump) | One blast kills inside 6 m, useless past 12 m |
| primary | `smg` | Grinder | smg | auto | Fastest close kill, as accurate moving as standing |
| primary | `burst` | Ratchet | burst | burst (3) | Tight, steady mid range: wins 20 to 30 m |
| primary | `lmg` | Piledriver | lmg | auto | A 75-round belt that holds a lane; slow to carry and reload |
| primary | `marksman` | Plumb | marksman | semi | 2 body hits at any range, a headshot always kills; stand to shoot |
| primary | `sniper` | Surveyor | sniper | semi, scoped | A scoped body hit kills from 100 HP; wide hip cone, slow bolt |

Everyone carries one primary (slot 0, key 1) and one sidearm (slot 1, key 2). Press B to open the picker (it also shows on the respawn screen): primaries first, then sidearms, on the digit keys 1 to 9 then 0 in that order. A pick applies at the next spawn. The client sends `{ t: 'loadout', primary, secondary }` (either field may be left out); the server checks each id against its slot and ignores anything else.

## Fields of a gun file

All numbers are per bullet unless noted. Angles are degrees, times seconds, distances metres. The ranges in brackets are what `guns.test.js` accepts.

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Lowercase letters only, the same as the file name. Goes on the wire and in kill events. Must not clash with a power-up id (`bolt`, `pellet`, ...). |
| `name` | yes | What players see, 2 to 16 characters, unique. Never a name another game owns (the test keeps a list). |
| `slot` | yes | `'primary'` or `'secondary'` (a sidearm). |
| `class` | yes | Lowercase word. Picks the launch gun whose model, sound and effects the client borrows until this gun has its own (`BASE` in `index.js`). The ten brief classes are `pistol handcannon machinepistol rifle shotgun smg burst lmg marksman sniper`. |
| `dmg` | yes | Body damage at full range [1..200]. |
| `head` | yes | Headshot multiplier [1..4]. |
| `headDmg` | no | A flat headshot damage at any range, on every bullet, instead of `dmg * head` [dmg..300]. The rifle's 160. |
| `rps` | yes | Shots a second [0.5..20]. For a burst gun, the sustained rate: `count / (count / burst.rps + burst.delay)`. |
| `mode` | yes | `'semi'` (one shot a click), `'auto'` (holds), `'burst'` (one click fires `burst.count`). |
| `burst` | with `mode: 'burst'` only | `{ count, rps, delay }`: rounds a click [2..mag], the rate inside a burst [1..30], and the pause after a burst's last round [0..2]. A dry magazine, a reload or a switch ends a burst. |
| `mag` | yes | Magazine size, an integer [1..150]. Reserve ammo is infinite. |
| `reload` | yes | Reload seconds [0.2..6]; per shell with `perShell`. |
| `perShell` | no | `true` loads one round per `reload`, and firing interrupts the reload (the shotgun). Leave it out otherwise. |
| `pellets` | no | Pellets a shot [2..20], each dealing `dmg`. A blast is a headshot when most landed pellets hit the head. |
| `spreadStand`, `spreadMove` | yes | Cone half-angle standing and at full run speed, blended by speed [0..15], stand ≤ move ≤ 20. Airborne doubles the move value, crouched is 0.8× stand. |
| `falloff` | no | `{ from, to, min }`: full damage to `from` m, scaled down linearly to `min` (0..1] at `to` m and beyond. Leave out for no falloff. |
| `bloom`, `bloomMax` | together, optional | Degrees added per heat (one heat a shot, cooling at 4/s), capped at `bloomMax` [bloom..6]. |
| `kick` | yes | `[base, climb]`: camera kick in degrees a shot, plus `climb` more per shot through a spray (up to 8 shots) [0..8, 0..2]. Client feel only; the server never reads it. |
| `speed` | no | Movement multiplier while held [0.5..1.1], default 1. |
| `fireSpeed` | no | Movement multiplier, on top, while the gun cycles after a shot [0.3..1]. |
| `scope` | no | Right mouse (KEY.AIM) scopes in. `{ fov, inSeconds, spread, moveSpread, speed, sens }`: view fov [10..80], seconds to scope in [0.05..1], the scoped cone standing and moving (only once fully scoped; tighter than the hip), the movement multiplier from the moment the scope starts [0.3..1], and the mouse sensitivity multiplier [0.1..1]. Switching or reloading drops the scope. |
| `look` | yes, `null` until drawn | The box model. See below. |
| `sound` | yes, `null` until voiced | The synthesis recipe. See below. |
| `icon` | yes, `null` until drawn | The HUD and kill-feed icon. See below. |

`auto` is not a field you write: `index.js` derives it from `mode` for older readers.

### The presentation fields

Each belongs to one workstream, sits on its own line of the gun file, and starts as `null`. While it is `null` the client draws and plays the launch gun from `baseGun(id)`. The owning workstream decides the exact shape; these are the contracts the other code can rely on.

- **`look`: a box model.** An object in the shape of a `MODELS` entry in `client/viewmodel.js`: `boxes`, a list of `{ part, color, size: [w, h, d], at: [x, y, z], rot?: [x, y, z] }` in metres and radians in the view space of the first-person rig (x right, y up, -z forward); `color` a palette name (`dark`, `metal`, `tan`, `slot`, ...); `muzzle: [x, y, z]` where the flash and tracers start; optional `anchor`, `rest`, `port`, `flash`, `kick`, `pivots` and `reload` keyframes as the launch guns have them. The third-person model may scale the same boxes down. Plain data: no three.js objects, no imports.
- **`sound`: a synthesis recipe.** An object in the shape of a `GUNSHOTS` entry in `client/audio.js`: `{ level (dB), n (voices), drive?, slap?, layers: { name: { src: 'noise' | 'sine', mode?: 'bp' | 'lp' | 'hp', f, f1?, q?, a, d?, dur?, at?, g?, sweep?, glide?, partials? } } }`. A shot, plus whatever mechanism layers the gun has (bolt, slide, pump), all synthesized in the browser: no sample files, no external requests.
- **`icon`: an SVG path.** A string, the `d` attribute of one `<path>` in a `0 0 24 24` viewBox, drawn filled with `currentColor` and facing right (muzzle at x = 24). It must read at 16 px.

## How to add a gun

1. Copy the gun file nearest the new one: `cp shared/guns/rifle.js shared/guns/carbine.js`.
2. Edit it: a new `id` (the file name), `name`, `slot` and `class`, then the numbers. Keep `look`, `sound` and `icon` as `null` until those workstreams draw it.
3. In `shared/guns/index.js`, add `import carbine from './carbine.js';` and put `carbine` at the **end** of `LIST`. The list order is the wire order (snapshots carry an index into it), so never insert in the middle.
4. A new class only: add it to `BASE` in the same file, mapped to `'pistol'`, `'rifle'` or `'shotgun'`, the launch gun it borrows a model and sound from.
5. Run the validation test: `node --test shared/guns/guns.test.js`. It names the field or rule a gun breaks.
6. Run the balance script and compare the new rows with the tables below: `node .scratch/harness/mc.mjs 2000 carbine,rifle` (trials, then guns; `MD=1` prints markdown; `TUNE='{"carbine":{"dmg":28}}'` tries numbers without editing the file).
7. Run every check (`npm test`, then the harness) before committing.

Nothing else needs code. The bots read a gun's role from its numbers (below), the picker lists every gun, and the server's loadout check reads the slot. Two limits: the digit keys reach the first ten guns in picker order (more stay clickable), and a new primary shifts the sidearms' digits by one.

## How bots use each gun

`tools/bot/aim.js` reads a role from the numbers, so a new gun needs no bot code:

- **close** (more than one pellet): fights inside its falloff, swaps to the sidearm beyond twice that range.
- **burst** (`mode` auto or burst): fires in duty bursts at its skill's duty cycle; a burst gun is clicked once per burst cycle, so it waits out `burst.delay`.
- **precision** (a scope, `rps` under 2, or `dmg` 45 and up on a semi): stands to shoot. A scoped gun holds KEY.AIM on its target, stands still throughout, fires only once fully scoped and its cone fits the target, keeps a 30 m ideal range, and goes to the sidearm inside 7.5 m.
- **tap** (anything else): clicks at the slower of its skill's tap rate and the gun's.

Each life a bot asks for a random primary and sidearm from the registry (`--loadout lmg,handcannon` on `tools/bot.js` fixes them instead). In a live run (9 normal bots, port 3161, until every gun had two kills), every gun got real kills, with no errors in the server or bot log. Kills: rifle 38, pistol 8, shotgun 2, handcannon 7, machinepistol 3, smg 23, burst 21, lmg 33, marksman 33, sniper 46. In bot hands the sniper leads (a scoped body hit kills) and the close guns trail (bots meet at range more often than up close). Rerun it from the repo root with `REPO=$PWD PORT=3161 BOTS=9 BOTARGS="--skill normal" .scratch/harness/serve.sh .scratch/harness/botmix.mjs`. To check one gun, add `--loadout p,s` to `BOTARGS` and pass `NEED=p,s`.

## Live loadout smoke

`.scratch/harness/pw/loadouts.mjs` drives a real browser through every primary and every sidearm. For each pair it saves the pick, joins (the client sends the loadout message), spawns, and fires the primary (scoping first for a scoped gun, spraying four rounds for an auto). Then it switches to the sidearm and fires that. A watcher socket confirms the server spawned the pair and accepted each shot. The predicted magazine must land on the server's shot count without ever jumping back up, and the movement correction must stay under 50 mm. It renders on the Low preset at 50% scale. A headless page on a loaded machine can freeze for seconds, and a frozen page's inputs then reach the server in a lump or the page is dropped. A pair that fails during a freeze of over 1.5 s, or a drop, runs again (six reruns at most). A failure without a freeze still fails. The last run passed all ten guns, with two reruns after drops. Run it from the repo root with `REPO=$PWD PORT=3161 VIEW=960x540 .scratch/harness/serve.sh .scratch/harness/pw/loadouts.mjs`.

## Kill tables

From `MD=1 node .scratch/harness/mc.mjs 2000`, through the real shared weapon code. Mean ms from the first shot to the kill (scoped guns: from starting to scope in); `-` is no kill within 4 s (three targets: 12 s) in most trials. Conditions: **body** aims at the body centre, standing; **human** adds a 0.6° gaussian aim error per axis per shot; **head** aims at the head; **move** runs at the gun's full pace; **three** drops three 100 HP targets in a row with human aim, magazine and reload counted; **shield** is a 160 HP target.

### body
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 300 | 300 | 300 | 300 | 418 | 523 |
| Rivet (pistol) | 433 | 433 | 433 | 433 | 583 | 583 |
| Crusher (shotgun) | 0 | 33 | 1696 | - | - | - |
| Sledge (handcannon) | 450 | 450 | 450 | 450 | 900 | 900 |
| Nailer (machinepistol) | 300 | 300 | 526 | 3057 | - | - |
| Grinder (smg) | 250 | 250 | 317 | 468 | 795 | 1212 |
| Ratchet (burst) | 333 | 333 | 333 | 333 | 383 | 433 |
| Piledriver (lmg) | 300 | 300 | 300 | 300 | 418 | 604 |
| Plumb (marksman) | 350 | 350 | 350 | 350 | 350 | 350 |
| Surveyor (sniper) | 350 | 350 | 350 | 350 | 350 | 350 |

### human
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 300 | 300 | 310 | 385 | 819 | 1273 |
| Rivet (pistol) | 433 | 433 | 443 | 547 | 1009 | 1658 |
| Crusher (shotgun) | 0 | 117 | 1754 | - | - | - |
| Sledge (handcannon) | 450 | 450 | 464 | 607 | 1620 | 2130 |
| Nailer (machinepistol) | 300 | 301 | 615 | 3243 | - | - |
| Grinder (smg) | 250 | 250 | 332 | 642 | 1177 | 1620 |
| Ratchet (burst) | 333 | 333 | 337 | 378 | 693 | 1239 |
| Piledriver (lmg) | 300 | 300 | 310 | 394 | 790 | 1584 |
| Plumb (marksman) | 350 | 350 | 359 | 477 | 744 | 1074 |
| Surveyor (sniper) | 350 | 350 | 362 | 484 | 735 | 1014 |

### head
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 0 | 0 | 0 | 0 | 0 | 0 |
| Rivet (pistol) | 133 | 133 | 133 | 133 | 140 | 282 |
| Crusher (shotgun) | 0 | 636 | 3154 | - | - | - |
| Sledge (handcannon) | 0 | 0 | 0 | 0 | 0 | 65 |
| Nailer (machinepistol) | 117 | 117 | 691 | - | - | - |
| Grinder (smg) | 50 | 50 | 117 | 433 | 1136 | 1469 |
| Ratchet (burst) | 33 | 33 | 33 | 33 | 33 | 33 |
| Piledriver (lmg) | 100 | 100 | 100 | 100 | 136 | 647 |
| Plumb (marksman) | 0 | 0 | 0 | 0 | 0 | 0 |
| Surveyor (sniper) | 350 | 350 | 350 | 350 | 350 | 350 |

### move
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 300 | 300 | 558 | 1298 | - | - |
| Rivet (pistol) | 433 | 433 | 436 | 681 | 1572 | 2460 |
| Crusher (shotgun) | 0 | 29 | 1695 | - | - | - |
| Sledge (handcannon) | 450 | 450 | 828 | 1584 | - | - |
| Nailer (machinepistol) | 300 | 300 | 850 | - | - | - |
| Grinder (smg) | 250 | 250 | 317 | 668 | 1301 | - |
| Ratchet (burst) | 333 | 335 | 620 | 1286 | - | - |
| Piledriver (lmg) | 300 | 317 | 575 | 1370 | - | - |
| Plumb (marksman) | 350 | 350 | 820 | 1614 | 2234 | - |
| Surveyor (sniper) | 350 | 448 | 1014 | 1571 | 1882 | - |

### three
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 1117 | 1117 | 1226 | 2060 | 5877 | 8423 |
| Rivet (pistol) | 1617 | 1617 | 1994 | 3462 | 5492 | 7719 |
| Crusher (shotgun) | 1817 | 2149 | 8972 | - | - | - |
| Sledge (handcannon) | 2267 | 2267 | 2547 | 4259 | 9206 | 10241 |
| Nailer (machinepistol) | 1050 | 2189 | 5268 | - | - | - |
| Grinder (smg) | 917 | 917 | 1253 | 4344 | 7872 | - |
| Ratchet (burst) | 1133 | 1133 | 1194 | 1539 | 4446 | 7437 |
| Piledriver (lmg) | 1150 | 1150 | 1207 | 1607 | 3689 | 6775 |
| Plumb (marksman) | 1817 | 1817 | 1846 | 2216 | 3600 | 5367 |
| Surveyor (sniper) | 1833 | 1833 | 1869 | 2359 | 3976 | 5487 |

### shield (160 HP, body aim)
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 500 | 500 | 500 | 501 | 760 | 1254 |
| Rivet (pistol) | 883 | 883 | 883 | 883 | 883 | 1033 |
| Crusher (shotgun) | 900 | 900 | 2852 | - | - | - |
| Sledge (handcannon) | 1350 | 1350 | 1350 | 1350 | 1350 | 1817 |
| Nailer (machinepistol) | 483 | 483 | 1406 | - | - | - |
| Grinder (smg) | 450 | 450 | 517 | 824 | 1543 | - |
| Ratchet (burst) | 683 | 683 | 683 | 683 | 683 | 828 |
| Piledriver (lmg) | 617 | 617 | 617 | 617 | 796 | 1301 |
| Plumb (marksman) | 717 | 717 | 717 | 717 | 717 | 717 |
| Surveyor (sniper) | 1083 | 1083 | 1083 | 1083 | 1083 | 1083 |

### one-shot: % of first shots that kill from 100 HP, human body aim
| gun | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| Mason (rifle) | 0 | 0 | 0 | 1 | 2 | 2 |
| Rivet (pistol) | 0 | 0 | 0 | 0 | 0 | 0 |
| Crusher (shotgun) | 100 | 87 | 0 | 0 | 0 | 0 |
| Sledge (handcannon) | 0 | 0 | 0 | 1 | 2 | 2 |
| Nailer (machinepistol) | 0 | 0 | 0 | 0 | 0 | 0 |
| Grinder (smg) | 0 | 0 | 0 | 0 | 0 | 0 |
| Ratchet (burst) | 0 | 0 | 0 | 0 | 0 | 0 |
| Piledriver (lmg) | 0 | 0 | 0 | 0 | 0 | 0 |
| Plumb (marksman) | 0 | 0 | 0 | 0 | 2 | 3 |
| Surveyor (sniper) | 100 | 100 | 98 | 84 | 65 | 47 |

### fastest per range (within 10% shares the cell)

primary
| condition | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| body | shotgun | shotgun | rifle/smg/lmg | rifle/lmg | burst/marksman/sniper | marksman/sniper |
| human | shotgun | shotgun | rifle/smg/burst/lmg | rifle/burst/lmg | burst/marksman/sniper | marksman/sniper |
| head | rifle/shotgun/marksman | rifle/marksman | rifle/marksman | rifle/marksman | rifle/marksman | rifle/marksman |
| move | shotgun | shotgun | smg | smg | smg | - |
| three | smg | smg | rifle/smg/burst/lmg | burst/lmg | lmg/marksman | marksman/sniper |

secondary
| condition | 2 m | 6 m | 12 m | 20 m | 30 m | 40 m |
| --- | --- | --- | --- | --- | --- | --- |
| body | machinepistol | machinepistol | pistol/handcannon | pistol/handcannon | pistol | pistol |
| human | machinepistol | machinepistol | pistol/handcannon | pistol | pistol | pistol |
| head | handcannon | handcannon | handcannon | handcannon | handcannon | handcannon |
| move | machinepistol | machinepistol | pistol | pistol | pistol | pistol |
| three | machinepistol | pistol | pistol | pistol | pistol | pistol |

