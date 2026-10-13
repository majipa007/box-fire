#!/bin/sh
# usage: [REPO=dir] [PORT=n] [BOTS=n] serve.sh <node-script> [args]
# Starts the Boxfire server from REPO on PORT (+ optional bots), runs the
# script with PORT set, then stops everything. For builders in worktrees.
S=/home/sukuna/personal_projects/game/.scratch/harness
W=${WORK:-/home/sukuna/personal_projects/boxfire-work}; mkdir -p "$W"
REPO=${REPO:-/home/sukuna/personal_projects/game}
PORT=${PORT:-3100}
LOG=${LOG:-$W/serve-$PORT.log}

# Headless browsers render on the CPU (SwiftShader), and up to eight builders
# share 12 cores: past a few at once every run crawls and input timing goes
# bursty. So browser scripts take one of BROWSER_SLOTS slots and the rest
# queue. Scripts that don't drive a browser (the netcode checks) never wait.
# Two, not three: eight builders reached 13 of 19 GB with swap before a reboot.
if grep -qs playwright "$1"; then
  SLOTS=${BROWSER_SLOTS:-2}; waited=0
  while :; do
    n=1
    while [ $n -le $SLOTS ]; do
      exec 9>"$W/browser-slot-$n.lock"
      if flock -n 9; then break 2; fi
      n=$((n + 1))
    done
    [ $waited = 0 ] && echo "serve.sh: all $SLOTS browser slots busy, queued (this is normal, not a hang)" >&2
    waited=$((waited + 2)); sleep 2
  done
  [ $waited -gt 0 ] && echo "serve.sh: got browser slot $n after ${waited} s" >&2
fi

cd "$REPO"
[ -d node_modules ] || npm install --silent >/dev/null 2>&1
PORT=$PORT node server/index.js > "$LOG" 2>&1 9>&- &
PID=$!
sleep 0.8
if [ -n "$BOTS" ]; then PORT=$PORT node tools/bot.js --count "$BOTS" >> "$LOG" 2>&1 9>&- & BPID=$!; sleep 0.5; fi
PORT=$PORT VIEW=$VIEW OUT=$OUT node "$@" 9>&-; CODE=$?
[ -n "$BPID" ] && kill $BPID 2>/dev/null
kill $PID 2>/dev/null
echo "--- server log ($LOG)"; tail -5 "$LOG"
exit $CODE
