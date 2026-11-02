#!/bin/sh
# Builds Astra.app in the repo: double-click it (or put it in your Dock) to start Astra without typing a command.
# It opens scripts/astra.command in Terminal, which she needs for typed input and her logs.
set -e
cd "$(dirname "$0")/.."
repo="$(pwd)"
app="$repo/Astra.app"
rm -rf "$app"
# Built with osacompile so macOS treats it as a proper app (a hand-made bundle with a shell script won't launch).
# The repo path is fixed at build time, so the app still works if you copy it elsewhere.
osacompile -o "$app" -e "do shell script \"open -a Terminal \" & quoted form of \"$repo/scripts/astra.command\""
echo "Built $app"
