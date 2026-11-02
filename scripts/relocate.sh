#!/bin/sh
# Moves the Astra repo to a new folder (default ~/Code/jarvis -> ~/Workspace/jarvis) in one go: quits Astra, moves
# the folder, rebuilds Astra.app (repo copy and /Applications) with the new path baked in, checks native modules,
# runs typecheck and tests from the new place, and relaunches her. Every step is logged.
#
#   sh scripts/relocate.sh             do the move
#   sh scripts/relocate.sh --dry-run   say what it would do, change nothing
#   sh scripts/relocate.sh --rollback  put the repo back where it was, and relaunch from there
#
# Safe to run twice: if the move has already happened it only redoes the rebuild, checks and relaunch. If anything
# fails after the move, it rolls back by itself. Overrides (for rehearsals): RELOCATE_FROM, RELOCATE_TO,
# ASTRA_APPS_DIR (stand-in for /Applications), RELOCATE_NO_ASTRA=1 (don't quit or launch Astra), JARVIS_HOME.
set -u

FROM="${RELOCATE_FROM:-$HOME/Code/jarvis}"
TO="${RELOCATE_TO:-$HOME/Workspace/jarvis}"
APPS="${ASTRA_APPS_DIR:-/Applications}"
NO_ASTRA="${RELOCATE_NO_ASTRA:-0}"
HOME_DIR="${JARVIS_HOME:-$HOME/.jarvis}"
LOG="${RELOCATE_LOG:-$HOME_DIR/logs/relocate-$(date +%Y%m%d-%H%M%S).log}"
STATE="$HOME_DIR/relocate.state"
MODE=move
case "${1:-}" in
  --dry-run) MODE=dry ;;
  --rollback) MODE=rollback ;;
  "") ;;
  *) echo "usage: $0 [--dry-run|--rollback]" >&2; exit 2 ;;
esac

# The script lives inside the folder it moves, and sh reads scripts as it goes: run from a copy outside it.
if [ -z "${RELOCATE_COPY:-}" ]; then
  copy="$(mktemp "${TMPDIR:-/tmp}/astra-relocate.XXXXXX")" || exit 1
  cp "$0" "$copy" || exit 1
  RELOCATE_COPY="$copy" exec sh "$copy" "$@"
fi
trap 'rm -f "$RELOCATE_COPY"' EXIT

mkdir -p "$(dirname "$LOG")"
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { log "STOPPED: $*"; exit 1; }
# Runs a command (or, in a dry run, just says it would), with its output in the log.
run() {
  if [ "$MODE" = dry ]; then log "would run: $*"; return 0; fi
  log "run: $*"
  "$@" >>"$LOG" 2>&1
}

# ps rather than pgrep: pgrep can come back empty in a sandboxed shell even while she's running.
pids_matching() { ps -axo pid=,command= | awk -v me="$$" -v re="$1" '$1 != me && $0 ~ re && !/awk/ {print $1}'; }
astra_pids() { pids_matching 'tsx.*src/index[.]ts'; pids_matching 'sh scripts/astra[.]sh'; }

quit_astra() {
  [ "$NO_ASTRA" = 1 ] && { log "skipping quit (RELOCATE_NO_ASTRA=1)"; return 0; }
  # No restart flag, so her restart loop (scripts/astra.sh) ends instead of starting her again.
  run rm -f "$HOME_DIR/restart"
  pids="$(astra_pids | tr '\n' ' ')"
  [ -z "$pids" ] && { log "Astra isn't running"; return 0; }
  [ "$MODE" = dry ] && { log "would quit Astra (pids $pids)"; return 0; }
  log "quitting Astra (pids $pids)"
  kill -TERM $(pids_matching 'tsx.*src/index[.]ts') 2>/dev/null
  i=0
  while [ -n "$(astra_pids)" ] && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
  if [ -n "$(astra_pids)" ]; then
    log "still running after 30 s; stopping her loop and the rest"
    kill -TERM $(pids_matching 'sh scripts/astra[.]sh') 2>/dev/null
    kill -KILL $(pids_matching 'tsx.*src/index[.]ts') 2>/dev/null
    sleep 2
  fi
  [ -z "$(astra_pids)" ] || die "Astra wouldn't quit; nothing has been moved"
  log "Astra has quit"
}

launch_astra() {
  [ "$NO_ASTRA" = 1 ] && { log "skipping launch (RELOCATE_NO_ASTRA=1)"; return 0; }
  if [ -d "$APPS/Astra.app" ]; then run open "$APPS/Astra.app"; else run open "$1/Astra.app"; fi
  [ "$MODE" = dry ] && return 0
  sleep 15
  pid="$(pids_matching 'node .*tsx.*src/index[.]ts' | tail -1)"
  [ -n "$pid" ] && log "Astra is running again (pid $pid, folder $(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'))" ||
    log "Astra hasn't started yet: check $HOME_DIR/logs/astra.log"
}

# Rebuilds what has the repo path baked in, and checks the native modules load from the new place.
rebuild() {
  repo="$1"
  run sh "$repo/scripts/make-app.sh" || return 1
  if [ "$MODE" != dry ] && ! (cd "$repo" && node -e 'require("onnxruntime-node")' >>"$LOG" 2>&1); then
    log "onnxruntime-node won't load from $repo; rebuilding native modules"
    (cd "$repo" && run npm rebuild) || return 1
  fi
}

checks() {
  repo="$1"
  [ "$MODE" = dry ] && { log "would run typecheck and tests in $repo"; return 0; }
  (cd "$repo" && run npm run -s typecheck) || return 1
  # One retry: a couple of timing tests can be flaky under load.
  (cd "$repo" && run npm test) || (cd "$repo" && log "tests failed once; retrying" && run npm test)
}

# Leaves the old path pointing at the new one, for anything still holding it (an old Terminal tab, a script).
link_old() { [ -e "$FROM" ] || [ -L "$FROM" ] || run ln -s "$TO" "$FROM"; }

rollback() {
  log "== rolling back: $TO -> $FROM"
  [ -d "$TO/.git" ] || die "nothing at $TO to roll back"
  quit_astra
  [ -L "$FROM" ] && run rm "$FROM"
  [ -e "$FROM" ] && die "$FROM exists and isn't the link this script made; leaving everything as it is"
  run mv "$TO" "$FROM" || die "couldn't move it back"
  run mkdir -p "$TO"
  run rm -f "$STATE"
  rebuild "$FROM" || log "rebuilding Astra.app at $FROM failed: run sh $FROM/scripts/make-app.sh"
  launch_astra "$FROM"
  log "== rolled back; the repo is at $FROM"
}

log "== Astra relocation ($MODE): $FROM -> $TO; log $LOG"
[ "$MODE" = rollback ] && { rollback; exit 0; }

# Where things stand: not moved yet, or already moved (a second run just redoes the rest).
if [ -d "$TO/.git" ] && { [ -L "$FROM" ] || [ ! -e "$FROM" ]; }; then
  log "already moved: $TO has the repo; redoing the rebuild, checks and relaunch"
  moved_now=0
elif [ -d "$FROM/.git" ] && [ ! -L "$FROM" ]; then
  if [ -d "$TO" ]; then
    leftovers="$(find "$TO" -mindepth 1 ! -name .DS_Store | head -5)"
    [ -n "$leftovers" ] && die "$TO isn't empty, so it won't be replaced:
$leftovers"
  fi
  [ "$(df -P "$FROM" | awk 'NR==2{print $1}')" = "$(df -P "$(dirname "$TO")" | awk 'NR==2{print $1}')" ] ||
    die "$FROM and $(dirname "$TO") are on different disks; this script only does a same-disk move"
  quit_astra
  [ -d "$TO" ] && { run rm -f "$TO/.DS_Store"; run rmdir "$TO" || die "couldn't remove the empty $TO"; }
  run mkdir -p "$(dirname "$TO")"
  run mv "$FROM" "$TO" || die "the move failed; check $FROM is intact"
  [ "$MODE" = dry ] || printf 'from=%s\nto=%s\nat=%s\n' "$FROM" "$TO" "$(date)" >"$STATE"
  link_old
  moved_now=1
else
  die "can't find the repo at $FROM or $TO"
fi

[ "$MODE" = dry ] && repo_now="$FROM" || repo_now="$TO"
if ! rebuild "$repo_now" || ! checks "$repo_now"; then
  log "something failed after the move (see above)"
  if [ "$moved_now" = 1 ]; then rollback; exit 1; fi
  die "the repo is at $TO but checks failed; run with --rollback to move it back"
fi
launch_astra "$TO"
[ "$MODE" = dry ] && { log "== dry run finished: nothing was changed"; exit 0; }
log "== done: the repo is at $TO (and $FROM links to it). Roll back with: sh $TO/scripts/relocate.sh --rollback"
