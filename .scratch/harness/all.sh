#!/bin/sh
# Every check: unit tests, in-process server checks, live server checks.
# usage: [REPO=dir] [PORT=n] all.sh   (defaults: the main repo on port 3100)
# From a worktree, the verify scripts are copied with their imports pointed at REPO.
S=/home/sukuna/personal_projects/game/.scratch/harness
W=${WORK:-/home/sukuna/personal_projects/boxfire-work}; mkdir -p "$W"
MAIN=/home/sukuna/personal_projects/game
REPO=${REPO:-$MAIN}
PORT=${PORT:-3100}
T=$(mktemp -d "$W/check-XXXXXX")
for v in "$S"/verify*.mjs; do sed "s#$MAIN/#$REPO/#g" "$v" > "$T/$(basename "$v")"; done
cd "$REPO" || exit 1
FAIL=0
for f in server/*.js shared/*.js client/*.js tools/*.js; do node --check "$f" || { echo "SYNTAX $f"; FAIL=1; }; done
TESTS=$(npm test 2>&1) || FAIL=1; printf "%s\n" "$TESTS" | grep -E "^ℹ (pass|fail)"; [ $FAIL = 0 ] || printf "%s\n" "$TESTS" | grep -E "^not ok|✖" | head -20
for v in verify08 verify10 verify11 verify14 verify15 verify16 verify_review; do
  node "$T/$v.mjs" >/dev/null 2>&1 && echo "ok   $v" || { echo "FAIL $v"; FAIL=1; }
done
for v in verify01 verify05 verify07 verify16live; do
  REPO=$REPO PORT=$PORT LOG=$T/$v.log "$S/serve.sh" "$T/$v.mjs" >/dev/null 2>&1 && echo "ok   $v (live)" || { echo "FAIL $v (live, log $T/$v.log)"; FAIL=1; }
done
[ $FAIL = 0 ] && rm -rf "$T"
exit $FAIL
