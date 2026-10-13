# Boxfire visual-check tools (headless Chromium, SwiftShader)

- `../serve.sh <script> [args]` — start the server from $REPO on $PORT (+ $BOTS bots), run the script, stop.
- `shots.mjs <prefix>` — four fixed-angle 1280x720 screenshots (overview, lane, side, crates) via
  `?debug&cam=x,y,z,yaw,pitch`, saved to $OUT (default: this folder) as <prefix>-<angle>.png.
- `smoke.mjs <name> [steps.mjs]` — join, start, run optional steps, screenshot <name>.png; fails on console errors.
  Set VIEW=640x360 for interactive steps (SwiftShader at 1280x720 starves the CPU and makes input bursty).

Example from a worktree:
  REPO=/path/to/worktree PORT=3105 BOTS=4 OUT=/path/to/shots .scratch/harness/serve.sh .scratch/harness/pw/shots.mjs after

Logs, check folders and screenshots go to $WORK (default /home/sukuna/personal_projects/boxfire-work), outside the repo.
