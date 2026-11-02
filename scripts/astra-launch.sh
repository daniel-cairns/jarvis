#!/bin/sh
# Started by Astra.app: runs Astra in the background with no Terminal window, through the usual restart loop
# (scripts/astra.sh). Output goes to ~/.jarvis/logs/astra.log; the previous run's is kept as astra.log.1.
cd "$(dirname "$0")/.." || exit 1
if pgrep -f "tsx.*src/index.ts" >/dev/null; then
  osascript -e 'display notification "Astra is already running." with title "Astra"'
  exit 0
fi
logs="${JARVIS_HOME:-$HOME/.jarvis}/logs"
mkdir -p "$logs"
[ -f "$logs/astra.log" ] && mv "$logs/astra.log" "$logs/astra.log.1"
exec sh scripts/astra.sh </dev/null >>"$logs/astra.log" 2>&1
