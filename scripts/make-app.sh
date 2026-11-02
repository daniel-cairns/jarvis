#!/bin/sh
# Builds Astra.app in the repo, and refreshes /Applications/Astra.app if it's there. Opening it starts Astra like a
# normal app: no Terminal window, just her orb and menu-bar icon (scripts/astra-launch.sh, logs in ~/.jarvis/logs).
set -e
cd "$(dirname "$0")/.."
repo="$(pwd)"
app="$repo/Astra.app"

# An app gets a bare PATH, without the shell setup that finds node (fnm) or sox and whisper (Homebrew). Bake one in:
# node's real folder (fnm's per-shell link folders vanish), its global npm tools, and Homebrew.
node_dir="$(dirname "$(node -p process.execPath)")"
path="$node_dir:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

script="$(mktemp -t astra-app).applescript"
cat > "$script" <<APPLESCRIPT
-- Starts Astra in the background and returns at once (all output goes to her log, so this doesn't wait).
do shell script "export PATH=" & quoted form of "$path" & "; nohup /bin/sh " & quoted form of "$repo/scripts/astra-launch.sh" & " >/dev/null 2>&1 &"
APPLESCRIPT

rm -rf "$app"
# Built with osacompile so macOS treats it as a proper app (a hand-made bundle with a shell script won't launch).
osacompile -o "$app" "$script"
rm -f "$script"

# With no Terminal in between, macOS asks on behalf of Astra.app itself for the microphone (sox records through it).
# Without this description it refuses without asking, and she hears nothing.
# (osacompile adds a generic description; replace it with one that says why.)
plist="$app/Contents/Info.plist"
mic="Astra listens for her name and for what you ask her."
/usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription '$mic'" "$plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string '$mic'" "$plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.astra.launcher" "$plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.astra.launcher" "$plist"
# Editing the bundle breaks osacompile's signature; re-sign (ad hoc) so macOS still opens it.
codesign --force --deep --sign - "$app"
echo "Built $app"

if [ -d /Applications/Astra.app ]; then
  rm -rf /Applications/Astra.app
  ditto "$app" /Applications/Astra.app
  echo "Updated /Applications/Astra.app"
fi
