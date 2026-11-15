#!/bin/bash
# Build "God's Eye View.app" and a DMG on macOS. Run from the repository root
# after `npm ci` (and `npm run build:panel`, for Claude Desktop's panel):
#
#   packaging/macos/build-app.sh <output-dir>
#
# The node binary is the one running this script, so build on the CPU the
# app is for (Apple silicon or Intel).
set -euo pipefail

OUT="${1:?usage: build-app.sh <output-dir>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="God's Eye View"
APP="$OUT/$NAME.app"
RES="$APP/Contents/Resources"
VERSION="$(node -p "require('$ROOT/package.json').version")"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
BUILD="$VERSION-$COMMIT"
ARCH="$(uname -m)"

rm -rf "$OUT"
mkdir -p "$OUT"

echo "== Applet"
osacompile -s -o "$APP" "$ROOT/packaging/macos/launcher.applescript"
PLIST="$APP/Contents/Info.plist"
# plutil takes the value as one argument, so the apostrophe in the name
# needs no quoting (PlistBuddy parses quotes inside its command string).
set_plist() {
  plutil -replace "$1" -string "$2" "$PLIST"
}
set_plist CFBundleIdentifier local.godseyeview.app
set_plist CFBundleName "$NAME"
set_plist CFBundleDisplayName "$NAME"
set_plist CFBundleShortVersionString "$VERSION"
set_plist CFBundleVersion "$BUILD"

echo "== Icon"
ICONSET="$(mktemp -d)/applet.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ROOT/public/icons/icon-512.png" \
    --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  [ "$double" -le 512 ] && sips -z "$double" "$double" \
    "$ROOT/public/icons/icon-512.png" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns -o "$RES/applet.icns" "$ICONSET"

echo "== Node $(node --version) ($ARCH)"
mkdir -p "$RES/node/bin"
cp "$(command -v node)" "$RES/node/bin/node"
cp "$ROOT/packaging/macos/gev.sh" "$RES/gev.sh"
chmod +x "$RES/gev.sh" "$RES/node/bin/node"

echo "== App files"
mkdir -p "$RES/app"
# Tracked files of this commit, then the installed dependencies and the
# built Claude Desktop panel. Tests and the Vite cache are left out.
git -C "$ROOT" archive HEAD | tar -x -C "$RES/app"
rsync -a --exclude .vite --exclude .cache "$ROOT/node_modules/" "$RES/app/node_modules/"
if [ -d "$ROOT/dist/panel" ]; then
  mkdir -p "$RES/app/dist"
  rsync -a "$ROOT/dist/panel/" "$RES/app/dist/panel/"
fi
echo "$BUILD" >"$RES/app/.gev-build"
du -sh "$RES/app" "$RES/app/node_modules"

echo "== Sign (ad hoc)"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
# Reported, not fatal: macOS runs an ad hoc signed applet either way.
codesign --verify --deep --strict --verbose=2 "$APP" ||
  echo "::warning::codesign --verify reported the problems above"

echo "== DMG"
STAGE="$(mktemp -d)/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/$NAME.app"
ln -s /Applications "$STAGE/Applications"
cp "$ROOT/packaging/macos/INSTALL.zh-Hant.txt" "$STAGE/安裝說明.txt"
DMG="$OUT/GodsEyeView-$BUILD-$ARCH.dmg"
hdiutil create -volname "$NAME" -srcfolder "$STAGE" -format UDZO -ov "$DMG"
ls -lh "$DMG"
echo "dmg=$DMG" >>"${GITHUB_OUTPUT:-/dev/null}"
