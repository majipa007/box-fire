#!/bin/sh
# usage: [REPO=dir] [PORT=n] [BOTS=n] serve.sh <node-script> [args]
# Starts the Boxfire server from REPO on PORT (+ optional bots), runs the
# script with PORT set, then stops everything. For builders in worktrees.
S=/home/sukuna/personal_projects/game/.scratch/harness
W=${WORK:-/home/sukuna/personal_projects/boxfire-work}; mkdir -p "$W"
REPO=${REPO:-/home/sukuna/personal_projects/game}
PORT=${PORT:-3100}
LOG=${LOG:-$W/serve-$PORT.log}
cd "$REPO"
[ -d node_modules ] || npm install --silent >/dev/null 2>&1
PORT=$PORT node server/index.js > "$LOG" 2>&1 &
PID=$!
sleep 0.8
if [ -n "$BOTS" ]; then PORT=$PORT node tools/bot.js --count "$BOTS" >> "$LOG" 2>&1 & BPID=$!; sleep 0.5; fi
PORT=$PORT VIEW=$VIEW OUT=$OUT node "$@"; CODE=$?
[ -n "$BPID" ] && kill $BPID 2>/dev/null
kill $PID 2>/dev/null
echo "--- server log ($LOG)"; tail -5 "$LOG"
exit $CODE
