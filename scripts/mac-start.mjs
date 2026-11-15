#!/usr/bin/env node
/**
 * macOS app launcher: the entry point the God's Eye View app bundle runs
 * (packaging/macos/gev.sh). It starts Vite on loopback the way
 * scripts/pinokio-start.mjs does, from the writable copy of the app in the
 * user's Application Support folder, so Provider Settings saves keys to that
 * copy's .env and caches land beside it.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDirectInvocation } from './pinokio-install.mjs';
import { loadViteFromCanonicalRoot } from './pinokio-start.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = realpathSync(path.resolve(path.dirname(MODULE_PATH), '..'));

/**
 * The port to listen on: PORT when it is a valid port, else 4173.
 * @param {string|undefined} value
 * @returns {number}
 */
export function macLaunchPort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 4173;
}

async function start() {
  const port = macLaunchPort(process.env.PORT);
  const { createServer } = await loadViteFromCanonicalRoot(ROOT);
  const server = await createServer({
    root: ROOT,
    // The app's own log has no terminal to clear.
    clearScreen: false,
    server: {
      // This Mac only; the app never offers the server to the network.
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  });
  await server.listen();
  console.log(`[Mac] Ready at http://127.0.0.1:${port}/`);

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

if (isDirectInvocation(process.argv[1], MODULE_PATH)) {
  start().catch((error) => {
    console.error(`[Mac] Start refused: ${error.message}`);
    process.exitCode = 1;
  });
}
