#!/bin/sh
# Starts Astra in this Terminal window (double-clicked by Astra.app). Does nothing if she's already running.
cd "$(dirname "$0")/.." || exit 1
if pgrep -f "tsx.*src/index.ts" >/dev/null; then
  echo "Astra is already running. Look for her orb, or her icon in the menu bar."
  exit 0
fi
exec sh scripts/astra.sh "$@"
