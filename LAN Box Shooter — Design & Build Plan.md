# Boxfire — Design & Build Plan

05/10/2026 · @Sulav Kumar Shresta

## Overview

A browser first-person shooter, boxy and flat-shaded, that friends play over the same WiFi with no internet and no installs. One person hosts; everyone else opens a URL. Version 1 is free-for-all deathmatch only.

Hard constraints:

- Runs at 60 fps, 1080p, on a laptop with integrated graphics.
- LAN only: no internet dependency anywhere, including library loading.
- Friends install nothing. Only the host needs Node.js (later: a single .exe).
- Join in under 30 seconds: open URL, type a name, you are in the lobby.
- Up to 10 players; the cap is one constant, judged for crowding in the first real session.

Out of scope for v1: abilities, round economy, spike plant, voice chat, mobile, accounts.

Assumed for v1:

- Desktop browsers only: current Chrome, Edge, Firefox and Safari.
- No join password: anyone on the WiFi with the URL can join. A room code in the URL can come later if the game is ever hosted on shared WiFi.
- Nothing is written to disk. Names and scores live in server memory only, are never logged, and disappear when the process stops, so nothing is retained (PDPA-clean).

## Architecture

&#91;embedded content: architecture · 1 host server, N browser clients, shared sim\]

The host's own browser connects to `localhost:3000` and is treated exactly like any other client. Kill, hit and match-end events ride the same socket as snapshots.

## Joining a game

The browser cannot broadcast on a network, so there is no auto-discovery: the host shares one URL and that is the whole join flow.

1. Host runs `npm start` in the repo folder. The server starts on port 3000; if something else already holds it, `PORT=3001 npm start` picks another port (the firewall rule in gotcha 5 must match).
2. Terminal prints every LAN IPv4 address as a URL, e.g. `http://192.168.1.42:3000`, read from `os.networkInterfaces()`. Host pastes it into the group chat.
3. First run on Windows triggers a firewall prompt: allow on Private networks (see gotcha 5). macOS prompts the same way.
4. Friends open the URL, type a display name (trimmed, 1–16 characters), land in the lobby.
5. Lobby shows connected players and their ping. Host sees a Start button; everyone else sees "waiting for host".
6. Host starts. Anyone who opens the URL after that drops straight into the running match.

The host is whichever connection arrives from loopback (`127.0.0.1`, `::1`, or the IPv4-mapped `::ffff:127.0.0.1`); with none, the first player to join. If the host leaves, the role passes to the longest-connected player, which also covers a spare laptop running the server with nobody at it. Bots from the bot tool also connect from the host machine, so they flag themselves in `join` and are never host.

If the URL times out for everyone, the router is blocking device-to-device traffic (guest, campus, hotel and some mesh WiFi do this). Fallback: one person turns on a phone hotspot and everyone joins that.

## Netcode

Server-authoritative over WebSockets, everything on one 60 Hz clock: the client samples input and steps its own movement at a fixed 60 Hz, the server ticks at 60 Hz, and one snapshot goes down every tick. One `dt = 1/60` everywhere removes a whole class of prediction bugs.

How each side works:

- Client samples input on a fixed 60 Hz timer, not per rendered frame, steps its own movement with `dt = 1/60`, and sends that one packet with a sequence number. Mouse look still turns the camera every rendered frame; only the packet is 60 Hz. Fire and jump are latched, so a press that starts and ends between two samples still counts in the next packet.
- Own player renders interpolated between the last two fixed steps, so a 144 Hz screen sees smooth motion instead of 60 Hz stepping.
- Server normally applies one input per player per tick, from a jitter buffer `INPUT_BUFFER` packets deep (start at 1); the input hygiene rules below cover the exceptions. Then it moves players, resolves collisions, runs hitscan and broadcasts the snapshot.
- Reconciliation: on each snapshot the client snaps its own player to the server state and replays the inputs the server has not yet acknowledged. So the snapshot carries everything `movement.step` and `weapons.step` read for your own player: velocity, on-ground, crouch, both magazines, fire cooldown, reload and switch timers. Replaying from partial state, such as a jump without its vertical velocity, makes every jump jitter. Your own yaw and pitch are never reconciled: the camera belongs to the client.
- Other players render `INTERP_DELAY_TICKS` behind (start at 2, \~33 ms) and interpolate between snapshots. If snapshots run dry they freeze, never extrapolate: a frozen target is a real tick in the server's history, so rewound shots at it still register, while an extrapolated position never existed on the server.
- Hit registration rewinds. The server keeps 1 s (60 ticks) of per-player hitbox positions. Each input carries the fractional tick the client was rendering others at (tick plus interpolation fraction); `history.js` blends between the two stored ticks around it, and shots are raycast against that past state. Without rewind, a target running at 5.5 m/s has moved \~0.2 m by the time the server sees the click, wider than the 0.3 m head box; a whole-number tick alone would still leave up to \~9 cm, a third of it.
- Spread and shotgun pellets come from a seeded PRNG in `shared/rng.js`, seeded by (server seed, player id, shot number). The server seed is picked once per server run and sent in `welcome`. The client's tracer and shot ray use the packet's yaw and pitch, not the live camera, which can be up to 16 ms of mouse movement ahead. So the tracer the client draws instantly and the ray the server tests are identical.
- Movement, collision, weapons (fire cooldown, magazines, reload and switch timers), the PRNG and the protocol live in `shared/` and run on both sides from the same code, so prediction cannot diverge from authority.
- Heartbeat: the server calls `ws.ping()` every 500 ms. A socket with no pong for 2 s counts as silent (see rejoin under Gameplay); at 5 s it is closed and the player greyed out. Browsers answer pings below the page's JavaScript, even in background tabs, so only dead connections go silent. The pong round trip is the lobby's ping column.
- JSON messages in v1. Budget at 10 players is about 10 × 60 Hz × 80 B ≈ 48 KB/s per client, trivial on LAN. Move to binary only if profiling says so.

`INPUT_BUFFER` and `INTERP_DELAY_TICKS` are constants, tuned in the first real session with the bot, the lobby ping and the host's tick-interval log. Make them adaptive only if no fixed values work for everyone.

Input hygiene. Every input is one fixed step, applied in order exactly once, so the client's prediction always replays the same steps the server ran:

- A queue more than 2 deep (`INPUT_BUFFER` + 1) gets two inputs applied in that tick to catch up, never more; beyond 8 queued (`MAX_INPUT_QUEUE`) the oldest are dropped, so a stalled client does not teleport when it wakes.
- Whenever inputs are dropped by that overflow, the earliest fire press among them carries into the next applied input together with its shot number and render tick (with several clicks inside one overflow, only that first one survives: a stall of over 130 ms with repeated clicking). Fire events are processed in order and the cooldown still gates each one; the dropped input's movement is lost. Without this, a long stall eats clicks the client already showed as shots.
- An empty tick applies nothing: the player stands still for that tick, and the jitter buffer refills before inputs are applied again. Nothing is ever invented or dropped for being late. (The first design repeated the last input on an empty tick and dropped the late input when it arrived; measured with a 20–40 fps client, that threw away 260–430 inputs per 10 s and lost direction changes, so it was replaced on 05/10/2026.)
- After 250 ms without input the server treats the player as neutral, no keys held. The client also clears its key state and sends a neutral packet on window blur, tab hide and pointer-lock loss, because keyup events never arrive for a background tab.
- The host's 10 s tick log also counts buffer underflows and overflow drops, the numbers to watch when tuning `INPUT_BUFFER` in the first session.

Trust boundary: one bad packet must never crash the host or put NaN into the shared sim. An exception in a `ws` message handler, or an `'error'` event on a socket with no listener, kills the Node process and the match with it. So `protocol.js` wraps `JSON.parse` in try/catch, drops any message containing NaN or infinite numbers, requires `seq` and shot number to be integers, clamps pitch to ±89°; `history.js` clamps the render tick into the stored second (`[tick − 60, tick]`) so a rewind can never index outside its buffer; every socket gets an `error` listener; and the `ws` server sets `maxPayload` to about 4 KB.

| Message | Direction | Payload | Rate |
| --- | --- | --- | --- |
| `join` | client → server | name, bot flag | once |
| `welcome` | server → client | your id, map id, tick rate, server seed, lobby state | once |
| `reject` | server → client | reason: name taken or game full | on a failed join |
| `lobby` | server → client | players (id, name, ping, colour slot, kills, deaths, connected), host id, phase, phase end tick | on change; ping refreshes every 1 s |
| `start` | host → server | — | once |
| `end_match` | host → server | — | on demand |
| `loadout` | client → server | primary: rifle or shotgun | on change |
| `input` | client → server | seq, render tick (fractional), keys bitmask, yaw, pitch, fire, shot number, weapon slot | 60 Hz |
| `snapshot` | server → client | tick, your last acked seq, players\[ id, pos, yaw, pitch, crouch, hp, weapon, state \], plus your own velocity, on-ground, both magazines, cooldown, reload and switch timers | 60 Hz |
| `event` | server → client | kill (killer, victim, weapon, headshot), hit (attacker, victim, damage, headshot: hit marker for the attacker, red arc for the victim), shot (shooter, weapon, origin, one impact per pellet: everyone but the shooter draws the tracers and hears it), spawn, match\_end | on occurrence |

## Gameplay v1: deathmatch

Free-for-all, first to 30 kills or 8 minutes, then a 15 s scoreboard and an automatic restart on the same map. All numbers below are starting values in `shared/constants.js`, meant to be tuned by feel.

Phases run lobby → playing → scoreboard (15 s) → playing. Someone joining during the scoreboard sees it and spawns with the next match. One player left: the match keeps running. Zero players for 30 s: back to the lobby with scores cleared, the grace so a WiFi blip does not wipe the rejoin scores. The host has an End match button in the Esc menu that jumps straight to the scoreboard, reusing the normal restart path.

Movement is Valorant-style: no sprint, no air strafing.

- Run 5.5 m/s, walk (Shift) 2.7 m/s, crouch 1.8 m/s with eye height dropping from 1.6 m to 1.1 m.
- Jump \~1 m high; gravity 20 m/s²; in-air control 20% of ground control. Jumpable ledges are at most 0.75 m; anything taller is reached over a 0.6 m crate. No slopes, stairs or step-up logic in v1.
- Player collider: axis-aligned box 0.6 × 1.8 × 0.6 m standing, 0.6 × 1.2 × 0.6 m crouched, swept against the map's boxes. Crouching shrinks the collider from the top, in the air too, so there is no crouch-jump in v1 and the ledge rules above hold. Standing up is blocked while anything is above the head.
- Players pass through each other. There is no player-vs-player collision, because predicting collisions against players drawn 33 ms in the past rubber-bands both of them.

Health is 100 with no armour. Dying respawns you after 3 s at the spawn point furthest from any enemy, skipping any point used in the last 3 s so two players who die together never spawn stacked, with 2 s of invulnerability that ends early if you fire; protected players blink so everyone can see it. Everyone carries the pistol plus one primary. Press B at any time, or use the same two-button panel on the respawn screen, to pick rifle or shotgun; the choice applies on the next spawn and defaults to the rifle, so drop-in players never need the lobby.

Scores are keyed by name for the length of the match: if a tab dies, reopening the URL with the same name gets the kills back. Names are compared case-insensitively, so rejoining as "sam" after playing as "Sam" still works. A name already in use is rejected, unless that slot has been silent (no heartbeat pong) for over 2 s, in which case the newcomer takes it over as a reconnect. Disconnected players stay on the scoreboard, greyed out, until the match ends, and keep their slot even if the game is full. Leaving mid-life counts as a death without a kill: a rejoin waits out the 3 s respawn, so refreshing the page never heals.

| Weapon | Body dmg | Head mult | Fire rate | Mag | Reload (s) | Spread stand / move (°) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pistol | 26 | 3× | 6.75/s semi | 12 | 1.75 | 0.3 / 1.5 | Always carried |
| Rifle | 40 | 4× (one-tap head) | 9.75/s auto | 25 | 2.5 | 0.4 / 2.5, camera kick climbs over 8 shots | Default primary |
| Shotgun | 8 × 12 pellets | 2× | 1.1/s pump | 5 | 0.5 per shell | 4.0 cone | Falloff beyond 8 m |

All weapons are hitscan, so there is no projectile simulation. Infinite reserve ammo, finite magazine. Weapon state (fire cooldown, magazines, reload and switch timers) is predicted on the client and corrected from snapshots exactly like movement, so the muzzle flash, ammo counter and empty click are instant and right.

Handling rules, every number in `constants.js`:

- Switching weapons takes 0.4 s before you can fire and cancels any reload. Each weapon keeps its own magazine.
- Pressing fire on an empty magazine starts a reload.
- Firing interrupts the shotgun's shell-by-shell reload.
- The cooldown is a seconds counter that carries its remainder between shots (`cooldown += 1/rps`, never reset to full): 9.75 shots/s is 6.15 ticks at 60 Hz, and rounding to whole ticks would change the fire rate. Whenever the player is not firing it is clamped with `cooldown = max(cooldown, 0)`; otherwise a released trigger banks shots and the next press fires about 10 in a row.
- Spread blends from the stand value to the move value by horizontal speed ÷ run speed, so stopping before you shoot matters. Airborne it is 2× the move value; crouched, 0.8× the stand value. Spread is random but seeded, so client and server roll the same numbers.
- Recoil is a camera kick you pull down to control: client-side only, with no server code, because the input already carries the resulting pitch.

Hitboxes are two boxes per player: a 0.3 m head cube on a 0.6 × 1.5 × 0.6 m body standing, or a 0.6 × 0.9 × 0.6 m body crouched; the server tests the head first, against rewound positions.

The v1 map is one 40 × 40 m arena in `shared/maps/arena_01.json`: a list of boxes (`pos`, `size`, `color`) plus spawn points. Open middle, two side lanes, scattered crates for cover, one raised platform at 1.2 m reached over a 0.6 m crate, 4 m perimeter walls. Because a map is pure data, a second map is just another JSON file.

## Look and performance

Flat-shaded boxes, no textures, no post-processing. Two palettes: a muted six-colour palette for the map, and a separate ten-colour player palette fixed per slot, so players always pop against the map. The budget is 60 fps at 1080p on an Intel Iris Xe class iGPU, which means under 300 draw calls and under 50k triangles per frame.

- Rendering: Three.js, `MeshLambertMaterial` with `flatShading`, one directional light plus a hemisphere light, light fog in the sky colour so the arena edge fades out. Shadows are a settings toggle, default off; a single 2048 shadow map when on.
- Static map: merge every box into one geometry per colour with `BufferGeometryUtils.mergeGeometries` (from the vendored Three.js addons), so the whole map is a handful of draw calls.
- Player model: four boxes (head, torso, two legs) plus a gun box, tinted with the colour of the player's slot. Name tag drawn on a canvas sprite above the head. Legs swing with movement speed; crouch scales the torso down.
- Weapon viewmodel: a box gun bottom-right with a recoil kick (translate back, rotate up, ease back over 80 ms). Muzzle flash is an emissive box shown for two frames. Tracer is a thin line from muzzle to hit point for 60 ms.
- Audio: Web Audio API synthesis only in v1 (gunshot = noise burst with a fast envelope, hit tick, footsteps, death thud), so there are zero asset files. Swap in .ogg later if wanted. The `AudioContext` starts on the click-to-play click (gotcha 3).
- Settings exposed: render scale 50–100%, FOV 70–110, shadows on/off, sensitivity, crosshair colour and size, and a low-end preset (50% scale, no shadows).
- `?debug` on the URL shows fps, draw calls, triangles, your position and unacknowledged inputs, for checking the 60 fps budget on the real laptops.

## Stack and repo layout

One npm dependency on the server (`ws`), zero on the client, no bundler.

- Server: Node.js 22 or newer, 24 LTS preferred (Node 20 reached end of life on 30/04/2026). Built-in `node:http` serves static files: `client/` at `/` and `shared/` at `/shared/`, because the browser imports the shared modules and the map too. A MIME map covers html, js and json, and a resolved-path check rejects any request that lands outside those two folders. `ws` attaches to the same server. `package.json` sets `"type": "module"` so Node loads the shared ES modules.
- Client: vanilla ES modules. Three.js is copied into `client/vendor/`, never loaded from a CDN: `three.module.js`, `three.core.js` and `addons/utils/BufferGeometryUtils.js`. Recent releases split the build, so check the first line of `three.module.js` when copying and copy whatever it imports. The import map maps both `three` and `three/addons/`.
- Shared: plain JS modules imported by both sides.
- Tests: `node --test` on `shared/` (movement, collision, ray-vs-box, rng.js gives the same pellets for the same seed, weapons.js cooldown and reload, including no banked shots after a released trigger) plus the server's history.js rewind lookup at fractional ticks. Netcode is tested by playing, against `tools/bot.js` when nobody else is around: a Node ws client that joins as a bot, strafes and jumps, and takes a `--count` flag to add several for a load test. It only sends inputs and the server moves it, so it exercises the real pipeline.

```
boxfire/
├─ package.json            # "type": "module"; "start": "node server/index.js", "bot": "node tools/bot.js"
├─ server/
│  ├─ index.js             # node:http static files + ws, heartbeat, prints LAN URL, host election
│  ├─ game.js              # 60 Hz tick loop, phases, authoritative state, shots and damage, snapshots, tick log
│  ├─ player.js            # per-player state, input queue + hygiene, fire carry-forward, respawn timer
│  └─ history.js           # 1 s ring buffer of hitbox positions, blended at fractional ticks
├─ shared/
│  ├─ constants.js         # TICK_RATE, INPUT_BUFFER, INTERP_DELAY_TICKS, speeds, weapon stats, palettes
│  ├─ movement.js          # step(player, input, dt, map) — same code both sides
│  ├─ collision.js         # swept AABB vs map boxes, crouch / uncrouch check
│  ├─ weapons.js           # cooldown, magazines, reload, switch, spread, hitboxes, shot trace — both sides
│  ├─ rng.js               # seeded PRNG for spread and pellets
│  ├─ protocol.js          # message types, encode / validated decode
│  └─ maps/
│     └─ arena_01.json
├─ client/
│  ├─ index.html           # import map → three, three/addons/
│  ├─ main.js              # boot, render loop, 60 Hz input timer, own shots, recoil, footsteps
│  ├─ net.js               # ws client, snapshot buffer, prediction + reconcile, freeze on starvation
│  ├─ input.js             # pointer lock, latched fire / jump, key state → input packets, neutral on blur
│  ├─ render.js            # scene, merged map, player meshes, first-person gun, tracers, muzzle flash
│  ├─ ui.js                # lobby, HUD, kill feed, scoreboard, Esc menu, weapon picker; names via textContent
│  ├─ audio.js             # Web Audio synth
│  └─ vendor/
│     ├─ three.module.js
│     ├─ three.core.js
│     └─ addons/utils/BufferGeometryUtils.js
└─ tools/
   └─ bot.js               # ws test client: strafes, jumps, --count N
```

Later, package the host as one file with Node's single executable applications or `bun build --compile`, so even the host installs nothing.

## Build order

Six milestones, each playable on its own; finish and feel-test one before starting the next. Effort guesses are evenings and are rough; M2 is where the hard bugs live.

- [ ] **M0 — Skeleton (1 evening).** Repo layout, `npm start` serves `client/` and `shared/`, prints the LAN URL, WebSocket connects with the heartbeat running. Lobby page: enter a name (validated, inserted with `textContent`), player list with ping updates live, the loopback connection is marked host and sees Start. Done when two laptops on the same WiFi see each other's names.
- [ ] **M1 — FPS controller, single player (2–3 evenings).** Pointer lock with `unadjustedMovement` (falling back to the plain call), mouse look, WASD / jump / crouch / walk with a latched jump, swept AABB collision against `arena_01.json`, gravity, fixed-timestep `shared/movement.js`. Esc menu, opened on pointer-lock loss, with sensitivity and FOV saved to localStorage. Done when running around the arena feels tight with no clipping at a steady 60 fps.
- [ ] **M2 — See each other (3–4 evenings).** Input packets, server tick, snapshots, prediction and reconciliation for self from full own state, interpolation for others with freeze on starvation, name tags, tools/bot.js as a strafing target, tick-interval log on the host, first tuning of `INPUT_BUFFER` and `INTERP_DELAY_TICKS`. Done when two players move with no rubber-banding and the other player's motion is smooth.
- [ ] **M3 — Shooting (2–3 evenings).** Rifle only. Server hitscan with 1 s rewind at fractional ticks against head and body boxes, seeded spread, tracer from the packet's angles, shared weapons.js with predicted cooldown (clamped, no banking) and magazine, fire carry-forward for dropped inputs, HP, death, 3 s respawn at the far spawn, kill feed, hit marker. Done when a 1v1 is fun for five minutes.
- [ ] **M4 — Full deathmatch (3–4 evenings).** Pistol and shotgun, weapon switch with the 0.4 s switch time, reload (cancelled by switching, automatic on empty, shell reload interrupted by firing), speed-blended spread and recoil, scoreboard, match timer, win condition, restart, spawn protection and recent-spawn skip, drop-in join, rejoin by name with heartbeat takeover, B weapon picker, phase edge cases, host End match. Done when four or more players finish a full match with no desyncs.
- [ ] **M5 — Polish (ongoing).** Synth audio, key rebinding, crosshair options, low-end render mode, second map, host as a single executable.

## Gotchas to know before coding

Twelve things that are cheap to get right up front and expensive to discover mid-build.

1. **No CDN, ever.** One `<script src="https://…">` breaks the game the moment the WiFi has no internet. Vendor Three.js locally, including `three.core.js` and the addons it needs; missing either is a blank screen offline. Test once with the host's internet actually off.
2. **`file://` cannot work.** Opening `index.html` directly cannot open WebSockets to a LAN host or discover anything. The host server is the one non-negotiable piece.
3. **Pointer Lock needs a click.** It works on plain `http://` (no HTTPS required) but only after a user gesture. Show a "click to play" overlay. Esc always releases the lock and is the menu key, but open the menu on `pointerlockchange`, not on an Esc keydown: the browser swallows the Esc that releases the lock. Chrome also rejects a re-lock requested right after an Esc exit, so handle `pointerlockerror` with "click again". Request `{ unadjustedMovement: true }` to turn off OS mouse acceleration, falling back to the plain call if it rejects. The same click must create or resume the `AudioContext`, which browsers keep muted until a user gesture.
4. **Ctrl+W closes the tab.** If crouch is Ctrl, a player crouching while moving forward will close the game. Default crouch to C; rebinding comes in M5.
5. **Windows firewall and network profile. ⚠️ Live firewall change: get human review first.** First `npm start` prompts; the host must allow on Private networks. Windows also labels new WiFi as Public by default, which blocks inbound connections until the network is set to Private or an inbound rule for TCP 3000 is added. On an InCorp_SG-managed laptop, Intune or Defender policy may block or forbid local rules: check with IT first, or host from a personal machine. The least-privilege rule allows Private networks, the local subnet and one port only:

   ```powershell
   New-NetFirewallRule -DisplayName "Boxfire_TCP_3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -RemoteAddress LocalSubnet -Action Allow
   # after the session:
   Remove-NetFirewallRule -DisplayName "Boxfire_TCP_3000"
   ```

   Clicking Cancel on the first prompt usually leaves a block rule for node.exe, and block rules override allow rules. If friends cannot connect after that, delete the block rule instead of adding more allow rules.
6. **AP / client isolation.** Guest, campus, hotel and some mesh networks block peer traffic. Symptom: the URL times out for everyone. Fix: a phone hotspot.
7. **Shared sim must stay in step.** The same `movement.js` runs on both sides with a fixed `dt = 1/60` and no randomness inside movement. Reconciliation hides float drift; it does not hide logic differences or missing state, which show up as rubber-banding. Every field `step()` reads goes in the snapshot.
8. **Server loop drift.** `setInterval(fn, 16)` drifts under load. Use an accumulator on `process.hrtime.bigint()` and cap catch-up at 5 ticks so a stall does not teleport everyone. Log tick intervals on the host from M2: Windows timers may be coarse for a Node process (unverified), and the log is how you find out.
9. **Tab key default.** Call `preventDefault()` on Tab keydown or focus leaves the canvas and the scoreboard never shows.
10. **Host on power, ideally on Ethernet.** On battery, laptops let the WiFi radio doze between packets, adding tens of ms, and a lost TCP packet stalls the WebSocket and then delivers a burst. Keep the host plugged in, and on Ethernet if there is a port.
11. **Everything from the network is untrusted.** Player names go into the DOM with `textContent`, never `innerHTML`, or a name like `<img onerror=…>` runs script in every player's browser; name tags are drawn on a canvas, so they are already safe. Packets are validated as described under the Netcode trust boundary.
12. **Hosting from WSL2.** In WSL's default NAT networking, `os.networkInterfaces()` prints the WSL VM's internal address (e.g. `172.22.x.x`), which friends on the LAN cannot reach. Run the host with Windows Node, or switch WSL to mirrored networking (`networkingMode=mirrored` in `.wslconfig`). Port-proxying into WSL instead is a network rule change: it needs human review. Whether loopback host detection sees `127.0.0.1` through WSL's localhost forwarding is unverified.

## Controls and HUD

Every keyboard action can be rebound from the Esc menu (taking a key another action uses swaps them; binding Ctrl shows the Ctrl+W warning). Esc and the mouse buttons are fixed. Keys, sensitivity, FOV, the graphics settings and your primary pick are saved in the browser's localStorage; nothing personal is, not even your name.

| Action | Key |
| --- | --- |
| Move | W A S D |
| Look | Mouse (pointer lock) |
| Fire | Left mouse |
| Jump | Space |
| Walk (quiet, accurate) | Left Shift, hold |
| Crouch | C, hold (not Ctrl: Ctrl+W closes the tab) |
| Reload | R |
| Switch weapon | 1 / 2 / scroll wheel |
| Pick primary (rifle / shotgun) | B |
| Scoreboard | Tab, hold |
| Menu / release mouse | Esc |

HUD: crosshair centre with a hit marker flash; HP bottom-left; ammo as `mag / ∞` bottom-right; kill feed top-right; match timer and current leader top-centre; a red arc on the crosshair pointing toward whoever just hit you.

## After v1 and open decisions

Later phases, in rough order: spike plant mode (5v5, attack and defend, rounds, buy phase, simple economy) → second and third maps → abilities, starting with two or three simple ones (smoke box, flash, dash) → host as a single executable → voice chat, which needs HTTPS for `getUserMedia`, so a self-signed certificate and one browser warning click.

Still to decide:

- [ ] Kill target and match length: 30 kills / 8 min assumed, tune after the first real session.
