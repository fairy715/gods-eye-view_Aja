/**
 * Defaults this build ships with, applied after the environment and dotenv
 * files are read, so anything the operator set wins.
 * @module server/standalone/buildDefaults
 */

/**
 * The public Overpass instance, used when none is configured, so the
 * restaurants, cafés and hotels layer works on first launch. Its usage policy
 * allows light personal use; answers are cached on disk for a day or longer.
 * Set `OVERPASS_UPSTREAMS=off` to run without Overpass, or to your own
 * instance to stop using the public one.
 */
export const DEFAULT_OVERPASS_UPSTREAMS =
  'https://overpass-api.de/api/interpreter';

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Record<string, string|undefined>} The same object.
 */
export function applyBuildDefaults(env = process.env) {
  if (!String(env.OVERPASS_UPSTREAMS ?? '').trim())
    env.OVERPASS_UPSTREAMS = DEFAULT_OVERPASS_UPSTREAMS;
  return env;
}
