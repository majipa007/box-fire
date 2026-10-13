#!/bin/sh
# usage: [BOTS=n] run.sh <verify-script> [args] — server on PORT 3100 (+ optional bots), run script, stop all
S=/home/sukuna/personal_projects/game/.scratch/harness
W=${WORK:-/home/sukuna/personal_projects/boxfire-work}; mkdir -p "$W"
cd /home/sukuna/personal_projects/game
PORT=3100 node server/index.js > "$W/server.log" 2>&1 &
PID=$!
sleep 0.6
if [ -n "$BOTS" ]; then PORT=3100 node tools/bot.js --count "$BOTS" ${BOTARGS} > "$W/bots.log" 2>&1 & BPID=$!; sleep 0.5; fi
PORT=3100 node "$S/$1" $2 $3; CODE=$?
[ -n "$BPID" ] && kill $BPID 2>/dev/null
kill $PID 2>/dev/null
echo "--- server log"; cat "$W/server.log"
[ -n "$BPID" ] && { echo "--- bots log"; cat "$W/bots.log"; }
exit $CODE
