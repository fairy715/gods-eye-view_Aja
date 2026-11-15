#!/bin/bash
# God's Eye View for macOS: start or stop the local server.
#
#   gev.sh start   copy the app to Application Support when this build is
#                  new there, start the server, wait for it, print its URL
#   gev.sh stop    stop the server this app started
#   gev.sh url     print the URL
#
# The app bundle stays read-only. The server runs from a copy in
# ~/Library/Application Support/God's Eye View/app, so saved keys (.env) and
# caches (.gev-cache) can be written, and survive installing a newer build.
set -u

RES="$(cd "$(dirname "$0")" && pwd)"
NODE="$RES/node/bin/node"
SRC="$RES/app"
APP_NAME="God's Eye View"
DATA="${GEV_DATA_DIR:-$HOME/Library/Application Support/$APP_NAME}"
APP="$DATA/app"
LOG="$DATA/server.log"
PIDFILE="$DATA/server.pid"
PORT="${GEV_PORT:-4173}"
URL="http://127.0.0.1:$PORT/"
# What a newer build must not replace.
KEEP=(.env .gev-cache .gev-logs)

fail() {
  echo "$*" >&2
  exit 1
}

alive() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

answering() {
  /usr/bin/curl -fs -o /dev/null --max-time 3 "$URL"
}

port_taken() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

# Copy this build to Application Support unless it is already there. On the
# same APFS volume the copy is a clone: instant, and no extra disk space.
install_copy() {
  local build
  build="$(cat "$SRC/.gev-build" 2>/dev/null || echo unknown)"
  if [ -f "$APP/.gev-build" ] && [ "$(cat "$APP/.gev-build")" = "$build" ]; then
    return 0
  fi
  echo "Installing build $build to $APP" >>"$LOG"
  rm -rf "$APP.new"
  # -X leaves out extended attributes, such as the download quarantine.
  /bin/cp -RcX "$SRC" "$APP.new" 2>>"$LOG" || /bin/cp -RX "$SRC" "$APP.new" ||
    fail "Could not copy the app to $DATA"
  if [ -d "$APP" ]; then
    for name in "${KEEP[@]}"; do
      [ -e "$APP/$name" ] && mv "$APP/$name" "$APP.new/$name"
    done
    rm -rf "$APP"
  fi
  mv "$APP.new" "$APP" || fail "Could not install the app to $DATA"
}

start() {
  mkdir -p "$DATA" || fail "Could not create $DATA"
  if alive && answering; then
    echo "$URL"
    return 0
  fi
  if port_taken; then
    fail "Port $PORT is already in use by another program. Quit it, or set GEV_PORT."
  fi
  [ -x "$NODE" ] || fail "The app is incomplete: $NODE is missing."
  install_copy
  echo "--- $(date '+%Y-%m-%d %H:%M:%S') start" >>"$LOG"
  cd "$APP" || fail "Could not open $APP"
  HOST=127.0.0.1 PORT="$PORT" \
    nohup "$NODE" scripts/mac-start.mjs >>"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  # The first start after an install compiles more; give it two minutes.
  for _ in $(seq 1 240); do
    if answering; then
      echo "$URL"
      return 0
    fi
    alive || break
    sleep 0.5
  done
  stop >/dev/null 2>&1
  fail "The server did not start. See $LOG"
}

stop() {
  if alive; then
    local pid
    pid="$(cat "$PIDFILE")"
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PIDFILE"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  url) echo "$URL" ;;
  *) fail "Usage: gev.sh start|stop|url" ;;
esac
