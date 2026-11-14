/**
 * Layers this build keeps on: enabled at startup unless the user switched
 * them off, a choice remembered in this browser.
 * @module app/pinnedLayers
 */

export const PINNED_LAYER_IDS = Object.freeze(['venues', 'traffic']);
const STORAGE_KEY = 'gev.pinnedLayersOff';

function readOff(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeOff(storage, off) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify([...off]));
  } catch {
    // Private windows may refuse storage; the layer is then on every launch.
  }
}

/**
 * Enable the pinned layers and remember the user's own toggles.
 * @param {{setEnabled: Function, subscribe: Function, layers: Map}} dataManager
 * @param {{storage?: Storage|null, ids?: readonly string[]}} [options]
 * @returns {() => void} Stops remembering.
 */
export function installPinnedLayers(
  dataManager,
  { storage = globalThis.localStorage ?? null, ids = PINNED_LAYER_IDS } = {},
) {
  const off = readOff(storage);
  const unsubscribe = dataManager.subscribe((change) => {
    if (
      change?.type !== 'visibility' ||
      change.origin !== 'user' ||
      !ids.includes(change.layerId)
    )
      return;
    if (change.enabled) off.delete(change.layerId);
    else off.add(change.layerId);
    writeOff(storage, off);
  });
  for (const id of ids) {
    if (off.has(id) || !dataManager.layers.has(id)) continue;
    Promise.resolve(dataManager.setEnabled(id, true)).catch((error) =>
      console.warn(`[Data] ${id} pinned enable error:`, error),
    );
  }
  return unsubscribe;
}
