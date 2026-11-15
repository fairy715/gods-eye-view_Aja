#!/bin/bash
# Smoke test a built DMG on macOS, the way a person installs it: copy the app
# out of the disk image, open it, check the server and the map, then quit the
# app and check the server stopped.
#
#   packaging/macos/smoke-test.sh <dmg>
set -euo pipefail

DMG="${1:?usage: smoke-test.sh <dmg>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="God's Eye View"
URL="http://127.0.0.1:4173/"
DATA="$HOME/Library/Application Support/$NAME"
INSTALL="$(mktemp -d)/Applications"

echo "== Mount and install"
MOUNT="$(mktemp -d)/volume"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DMG" >/dev/null
ls -la "$MOUNT"
test -e "$MOUNT/Applications"
test -f "$MOUNT/安裝說明.txt"
mkdir -p "$INSTALL"
ditto "$MOUNT/$NAME.app" "$INSTALL/$NAME.app"
hdiutil detach "$MOUNT" >/dev/null
APP="$INSTALL/$NAME.app"
codesign --verify --verbose=2 "$APP" || echo "::warning::signature check failed"
"$APP/Contents/Resources/node/bin/node" --version
for key in CFBundleName CFBundleDisplayName CFBundleShortVersionString CFBundleVersion CFBundleIdentifier; do
  echo "$key: $(plutil -extract "$key" raw "$APP/Contents/Info.plist")"
done
test "$(plutil -extract CFBundleName raw "$APP/Contents/Info.plist")" = "$NAME"

echo "== Open the app"
open "$APP"
for i in $(seq 1 240); do
  if curl -fs -o /dev/null --max-time 3 "$URL"; then
    echo "server answered after $((i / 2)) s"
    break
  fi
  sleep 0.5
done
curl -fs -o /dev/null "$URL" || {
  echo "::error::the server did not answer"
  cat "$DATA/server.log" || true
  exit 1
}

echo "== Routes"
expect() {
  local want="$1" got
  shift
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  echo "$got $*"
  [ "$got" = "$want" ] || {
    echo "::error::expected $want"
    exit 1
  }
}
expect 200 "$URL"
expect 200 "${URL}src/travel/model.js"
expect 400 -H "Sec-Fetch-Site: same-origin" "${URL}api/travel/resolve?url=https://example.com/"
expect 503 -X POST -H "Origin: http://127.0.0.1:4173" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}' "${URL}api/claude/chat"
test -f "$DATA/app/.gev-build"
echo "installed build $(cat "$DATA/app/.gev-build")"
if grep -q '^cp: ' "$DATA/server.log"; then
  echo "::error::installing the copy fell back from a clone:"
  grep '^cp: ' "$DATA/server.log"
  exit 1
fi

echo "== Map in a browser"
node "$ROOT/packaging/macos/smoke-browser.mjs" "$URL" "$RUNNER_TEMP/smoke.png" ||
  echo "::warning::browser check failed (see above)"

echo "== Quit the app"
osascript -e 'tell application id "local.godseyeview.app" to quit'
for _ in $(seq 1 40); do
  curl -fs -o /dev/null --max-time 2 "$URL" || break
  sleep 0.5
done
if curl -fs -o /dev/null --max-time 2 "$URL"; then
  echo "::error::the server is still running after the app quit"
  exit 1
fi
echo "server stopped with the app"
tail -n 20 "$DATA/server.log"
