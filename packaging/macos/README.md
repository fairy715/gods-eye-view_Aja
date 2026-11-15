# macOS app

`God's Eye View.app` wraps the standalone server for people who would rather
double-click than use a terminal. It is unsigned (ad hoc) and not notarized:
it is meant for a few Macs you control, not for distribution.

- **launcher.applescript** — a stay-open applet. Opening it runs `gev.sh
  start` and opens the map in the default browser; reopening it opens the map
  again; quitting it runs `gev.sh stop`.
- **gev.sh** — copies the bundled app to
  `~/Library/Application Support/God's Eye View/app` when the build there is
  older (an APFS clone, so instant and free on the same volume), keeping
  `.env`, `.gev-cache` and `.gev-logs`, then starts `scripts/mac-start.mjs`
  with the bundled Node on 127.0.0.1:4173 (`GEV_PORT` overrides). The bundle
  itself is never written to.
- **build-app.sh** — run on a Mac after `npm ci` and `npm run build:panel`:
  builds the applet, adds Node (the one running the script, so build on the
  target CPU), the tracked files, `node_modules` and the Claude Desktop panel,
  signs ad hoc and writes a UDZO DMG.
- **smoke-test.sh** — installs the app from the DMG, opens it, checks the
  page and a few routes, loads the map in Chrome, quits the app and checks
  the server stopped.

`.github/workflows/macos-dmg.yml` runs both on an Apple silicon runner and
keeps the DMG as a run artifact. `INSTALL.zh-Hant.txt` goes into the DMG.
