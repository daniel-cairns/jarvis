#!/bin/sh
# Runs Astra, and runs her again whenever she restarts herself (she leaves a flag file, then quits as normal).
cd "$(dirname "$0")/.." || exit 1
flag="${JARVIS_HOME:-$HOME/.jarvis}/restart"
while :; do
  rm -f "$flag"
  npm run -s build:orb && npx tsx src/index.ts "$@"
  [ -f "$flag" ] || break
  echo "Restarting Astra…"
done
