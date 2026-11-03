#!/bin/sh
# Builds Astra.app and installs it in /Applications (npm run app). Opening it starts Astra like a normal app: no
# Terminal window, just her orb and menu-bar icon (scripts/astra-launch.sh, logs in ~/.jarvis/logs).
#
# The app is a small native launcher (native/astra-launcher.swift) that stays running as the parent of everything
# Astra starts, so macOS grants Microphone, Accessibility and Screen Recording to Astra.app itself. It's signed with a
# local identity ("Astra Local Signing", made on first run and kept in the login keychain) rather than ad hoc, so its
# identity doesn't change between builds and those permissions survive every rebuild. Code changes in the repo never
# need a rebuild: the app runs the repo in place. Rebuild only after moving the repo (scripts/relocate.sh does it).
set -e
cd "$(dirname "$0")/.."
repo="$(pwd)"
apps="${ASTRA_APPS_DIR:-/Applications}"
bundle_id="local.astra.app"
legacy_id="local.astra.launcher" # the old AppleScript launcher, whose stale permission entries we clear
identity="Astra Local Signing"
version="$(node -p 'require("./package.json").version')"

for tool in swiftc rsvg-convert iconutil codesign; do
  command -v "$tool" >/dev/null || { echo "make-app: $tool is missing (rsvg-convert: brew install librsvg)" >&2; exit 1; }
done

# An app gets a bare PATH, without the shell setup that finds node (fnm) or sox and whisper (Homebrew). Bake one in:
# node's real folder (fnm's per-shell link folders vanish), its global npm tools, and Homebrew.
node_dir="$(dirname "$(node -p process.execPath)")"
path="$node_dir:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

work="$(mktemp -d -t astra-app)"
trap 'rm -rf "$work"' EXIT
app="$work/Astra.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

# Creates the self-signed code-signing identity if the keychain doesn't have it. macOS never needs to trust it: the
# signature only has to stay the same from build to build. (The legacy PKCS#12 ciphers are the ones `security` reads.)
ensure_identity() {
  security find-identity -p codesigning | grep -q "\"$identity\"" && return 0
  command -v openssl >/dev/null || return 1
  cat > "$work/cert.cnf" <<EOF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$identity
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null &&
    openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -name "$identity" -passout pass:astra \
      -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -out "$work/id.p12" &&
    security import "$work/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P astra -T /usr/bin/codesign >/dev/null
}

# 1. The launcher.
swiftc -O -swift-version 5 native/astra-launcher.swift -o "$app/Contents/MacOS/Astra"

# 2. The icon, rendered from native/astra-icon.svg at every size macOS asks for.
iconset="$work/Astra.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" native/astra-icon.svg -o "$iconset/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) -h $((size * 2)) native/astra-icon.svg -o "$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/Astra.icns"

# 3. Info.plist. LSUIElement keeps her out of the Dock (she lives in the menu bar). The usage descriptions are what
# macOS shows when it asks; without the microphone one it refuses without asking, and she hears nothing.
plist="$app/Contents/Info.plist"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Astra</string>
  <key>CFBundleIdentifier</key><string>$bundle_id</string>
  <key>CFBundleName</key><string>Astra</string>
  <key>CFBundleDisplayName</key><string>Astra</string>
  <key>CFBundleIconFile</key><string>Astra</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Astra listens for her name and for what you ask her.</string>
  <key>NSAppleEventsUsageDescription</key><string>Astra operates apps for you when you ask her to.</string>
</dict>
</plist>
EOF
plutil -insert AstraRepo -string "$repo" "$plist"
plutil -insert AstraPath -string "$path" "$plist"
plutil -lint -s "$plist"
printf 'APPL????' > "$app/Contents/PkgInfo"

# 4. Sign. Ad hoc is the fallback, but then every rebuild looks like a new app and permissions must be granted again.
if ensure_identity; then
  codesign --force --sign "$identity" "$app"
else
  echo "make-app: couldn't create the '$identity' signing identity; signing ad hoc (permissions reset on rebuild)" >&2
  codesign --force --sign - "$app"
fi
codesign --verify --strict "$app"

# 5. Install. The old in-repo copy is removed so macOS only ever sees one Astra.
dest="$apps/Astra.app"
rm -rf "$dest" "$repo/Astra.app"
ditto "$app" "$dest"
echo "Installed $dest"

# Outside a rehearsal: register the app (so Finder and the Dock pick up the new icon) and clear the permission entries
# left by the old launcher, which no longer match anything and only show up as switches that do nothing.
if [ -z "${ASTRA_APPS_DIR:-}" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$dest"
  for service in Microphone Accessibility ScreenCapture; do tccutil reset "$service" "$legacy_id" >/dev/null 2>&1 || true; done
fi
