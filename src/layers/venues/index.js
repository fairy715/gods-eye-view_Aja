import * as Cesium from 'cesium';
import { t, msg } from '../../i18n/index.js';
import {
  VENUES_LAYER_ID,
  VENUE_COLORS,
  VENUE_KINDS,
  VENUE_PRESET,
  VENUE_TILE_LIMIT,
  mapVenueFeature,
  venueDistanceM,
  venueTileBox,
  venueTileChildren,
  venueTilesAround,
} from './model.js';
export * from './model.js';

const OVERLAY_SOURCE_ID = VENUES_LAYER_ID;
/** Named venues nearest the view centre that get a map label. */
const LABEL_LIMIT = 40;
/** Above this camera height the layer neither loads nor draws. */
const MAX_CAMERA_HEIGHT_M = 15_000;
/** Level-0 tiles kept in memory; the least recently viewed go first. */
const MAX_ROOTS = 36;
const CAMERA_DEBOUNCE_MS = 350;
const BUSY_RETRY_MS = 4_000;
const FAILED_RETRY_MS = 30_000;
const MAX_ATTEMPTS = 4;

const KIND_LABELS = Object.freeze({
  restaurant: msg('Restaurants'),
  cafe: msg('Cafés'),
  hotel: msg('Hotels'),
});

/** The level-0 tile a tile of any level sits in. */
function rootOf(key) {
  const [level, x, y] = key.split('/').map(Number);
  return `0/${x >> level}/${y >> level}`;
}

/**
 * Restaurants, cafés and hotels around the point the camera looks at, from
 * OpenStreetMap through the operator's Overpass (`/api/osm/features`). The
 * ground is cut into fixed tiles so an answer is fetched once and then served
 * from the server's cache; a tile too dense for one answer is refetched as
 * quarters. Nothing loads from high altitude, where a city is a single dot.
 *
 * @param {object} options
 * @param {object} options.overlayHost World-overlay label host.
 * @param {Function} options.search `/api/osm/features` client.
 * @param {Function} [options.requestRender] Asks the scene for a frame.
 * @param {Function} [options.onCredit] Called once when venues first show.
 */
export function createVenuesLayer({
  overlayHost,
  search,
  requestRender = () => {},
  onCredit = () => {},
} = {}) {
  if (!overlayHost) throw new TypeError('Venues requires an overlay host');
  if (typeof search !== 'function')
    throw new TypeError('Venues requires an OSM feature source');

  let viewer = null;
  let dataSource = null;
  let dataManager = null;
  let enabled = false;
  let moveEndRemove = null;
  let debounceTimer = null;
  let retryTimer = null;
  let abort = null;
  let running = false;
  let credited = false;
  /** true / false once the server answered, null while unknown. */
  let configured = null;
  let tooHigh = false;
  let error = null;
  let lastUpdate = null;
  let centre = null;
  /** Tile key → {status, attempts, retryAt, truncated}. */
  const tiles = new Map();
  /** Level-0 key → ids of the records it contributed, in viewing order. */
  const roots = new Map();
  /** Record id → {record, entity}. */
  const shown = new Map();
  const kinds = Object.fromEntries(VENUE_KINDS.map((kind) => [kind, true]));
  let wanted = [];

  const colors = Object.fromEntries(
    VENUE_KINDS.map((kind) => [
      kind,
      Cesium.Color.fromCssColorString(VENUE_COLORS[kind]),
    ]),
  );

  function viewCentre() {
    const camera = viewer?.camera;
    const canvas = viewer?.scene?.canvas;
    if (!camera) return null;
    let carto = null;
    if (canvas) {
      const hit = camera.pickEllipsoid(
        new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
      );
      if (hit) carto = Cesium.Cartographic.fromCartesian(hit);
    }
    carto ||= camera.positionCartographic;
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
    };
  }

  function cameraHeight() {
    const height = viewer?.camera?.positionCartographic?.height;
    return Number.isFinite(height) ? height : Infinity;
  }

  function refreshRow() {
    dataManager?.refreshLayerStats?.();
    requestRender('venues');
  }

  function paintLabels() {
    if (!enabled || tooHigh || !centre) {
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      return;
    }
    const named = [];
    for (const { record } of shown.values())
      if (record.name && kinds[record.kind])
        named.push({ record, distance: venueDistanceM(centre, record) });
    named.sort((a, b) => a.distance - b.distance);
    const entries = named.slice(0, LABEL_LIMIT).map(({ record }, index) => ({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat),
      variant: 'label',
      title: record.name.slice(0, 40),
      accent: VENUE_COLORS[record.kind],
      priority: LABEL_LIMIT - index,
      collisionGroup: 'ambient-label',
      paintLane: 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 12,
      verticalOnly: true,
      placement: 'above',
    }));
    overlayHost.setEntries(OVERLAY_SOURCE_ID, entries, {
      cohortLimit: LABEL_LIMIT,
      collisionCapacity: LABEL_LIMIT,
      moving: false,
    });
  }

  function addRecords(root, features) {
    const ids = roots.get(root);
    if (!ids || !dataSource) return;
    for (const feature of features) {
      const record = mapVenueFeature(feature);
      if (!record || shown.has(record.id)) continue;
      const entity = dataSource.entities.add({
        id: `venue:${record.id}`,
        name: record.name || t(KIND_LABELS[record.kind]),
        show: kinds[record.kind],
        position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat),
        point: {
          pixelSize: 8,
          color: colors[record.kind],
          outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          // On top only up close; beyond that the depth test keeps far-side
          // points from showing through buildings and terrain.
          disableDepthTestDistance: 2500,
        },
      });
      shown.set(record.id, { record, entity });
      ids.add(record.id);
    }
  }

  function evictRoots() {
    if (roots.size <= MAX_ROOTS) return;
    const keep = new Set(wanted.map(rootOf));
    for (const [root, ids] of roots) {
      if (roots.size <= MAX_ROOTS) break;
      if (keep.has(root)) continue;
      for (const id of ids) {
        const held = shown.get(id);
        if (held) dataSource?.entities.remove(held.entity);
        shown.delete(id);
      }
      roots.delete(root);
      for (const key of [...tiles.keys()])
        if (rootOf(key) === root) tiles.delete(key);
    }
  }

  /** Wanted level-0 tiles, each replaced by its quarters once truncated. */
  function expand(keys) {
    const out = [];
    for (const key of keys) {
      out.push(key);
      const tile = tiles.get(key);
      if (tile?.status === 'ready' && tile.truncated)
        out.push(...expand(venueTileChildren(key)));
    }
    return out;
  }

  function nextTile() {
    const now = Date.now();
    let wake = Infinity;
    for (const key of expand(wanted)) {
      const tile = tiles.get(key);
      if (!tile) return { key };
      if (tile.status !== 'failed' || tile.attempts >= MAX_ATTEMPTS) continue;
      if (tile.retryAt <= now) return { key };
      wake = Math.min(wake, tile.retryAt);
    }
    return { key: null, wake };
  }

  async function pump() {
    if (running || !enabled || tooHigh || configured === false) return;
    clearTimeout(retryTimer);
    const { key, wake } = nextTile();
    if (!key) {
      if (Number.isFinite(wake))
        retryTimer = setTimeout(pump, Math.max(250, wake - Date.now()));
      refreshRow();
      return;
    }
    running = true;
    const tile = tiles.get(key) || { attempts: 0 };
    tile.status = 'loading';
    tile.attempts += 1;
    tiles.set(key, tile);
    refreshRow();
    abort = new AbortController();
    const { signal } = abort;
    let result;
    try {
      result = await search(
        {
          preset: VENUE_PRESET,
          bbox: venueTileBox(key),
          limit: VENUE_TILE_LIMIT,
        },
        { signal },
      );
    } catch {
      result = { ok: false, status: 0, error: null };
    }
    running = false;
    if (signal.aborted || !enabled) {
      tiles.delete(key);
      return;
    }
    if (result?.ok && Array.isArray(result.features)) {
      configured = true;
      error = null;
      tile.status = 'ready';
      tile.truncated =
        result.truncated === true && venueTileChildren(key).length > 0;
      const root = rootOf(key);
      if (!roots.has(root)) roots.set(root, new Set());
      addRecords(root, result.features);
      lastUpdate = Date.now();
      if (!credited && shown.size) {
        credited = true;
        onCredit(viewer);
      }
      evictRoots();
      paintLabels();
    } else if (result?.code === 'OVERPASS_NOT_CONFIGURED') {
      configured = false;
      tiles.delete(key);
    } else {
      const busy = result?.status === 429 || result?.status === 503;
      tile.status = 'failed';
      tile.retryAt = Date.now() + (busy ? BUSY_RETRY_MS : FAILED_RETRY_MS);
      // A busy server is a wait, not a fault worth showing.
      if (!busy || tile.attempts >= MAX_ATTEMPTS)
        error = result?.error || msg('OpenStreetMap search failed.');
    }
    pump();
  }

  function refreshView() {
    if (!enabled || !viewer) return;
    tooHigh = cameraHeight() > MAX_CAMERA_HEIGHT_M;
    if (dataSource) dataSource.show = !tooHigh;
    centre = viewCentre();
    if (tooHigh || !centre) {
      wanted = [];
      paintLabels();
      refreshRow();
      return;
    }
    wanted = venueTilesAround(centre.lat, centre.lon, 1);
    // Viewing a tile again makes it the most recently used.
    for (const root of wanted) {
      const ids = roots.get(root);
      if (ids) {
        roots.delete(root);
        roots.set(root, ids);
      }
      // A tile that gave up gets a fresh start when it is looked at again.
      for (const key of expand([root])) {
        const tile = tiles.get(key);
        if (tile?.status === 'failed' && tile.attempts >= MAX_ATTEMPTS)
          tiles.delete(key);
      }
    }
    paintLabels();
    pump();
  }

  function scheduleRefresh() {
    if (!enabled) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshView, CAMERA_DEBOUNCE_MS);
  }

  function stopLoading() {
    clearTimeout(debounceTimer);
    clearTimeout(retryTimer);
    abort?.abort();
    abort = null;
    running = false;
    for (const [key, tile] of tiles)
      if (tile.status === 'loading') tiles.delete(key);
  }

  function setKind(kind, on) {
    if (!Object.hasOwn(kinds, kind)) return;
    kinds[kind] = Boolean(on);
    for (const { record, entity } of shown.values())
      if (record.kind === kind) entity.show = kinds[kind];
    paintLabels();
    refreshRow();
  }

  function counts() {
    const out = Object.fromEntries(VENUE_KINDS.map((kind) => [kind, 0]));
    for (const { record } of shown.values()) out[record.kind] += 1;
    return out;
  }

  const loading = () =>
    running || [...tiles.values()].some((tile) => tile.status === 'loading');

  return {
    id: VENUES_LAYER_ID,
    name: 'Restaurants, Cafés & Hotels',
    icon: '🍽',
    source: 'OpenStreetMap',
    updateInterval: 0,
    statsRefreshInterval: 1000,

    attachDataManager(manager) {
      dataManager = manager;
    },

    /** Unavailable only once the server says no Overpass is configured. */
    getSourceAvailability() {
      return configured === false
        ? {
            available: false,
            source: VENUES_LAYER_ID,
            reason: 'Needs an Overpass server (OVERPASS_UPSTREAMS)',
          }
        : { available: true, source: VENUES_LAYER_ID, reason: null };
    },

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(VENUES_LAYER_ID);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      moveEndRemove = viewer.camera.moveEnd.addEventListener(scheduleRefresh);
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      overlayHost.setVisible(OVERLAY_SOURCE_ID, true);
      // The manager calls update() right after enable(); it owns the first load.
      return true;
    },

    disable() {
      enabled = false;
      stopLoading();
      if (dataSource) dataSource.show = false;
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      return true;
    },

    async update() {
      refreshView();
      return true;
    },

    destroy() {
      this.disable();
      moveEndRemove?.();
      moveEndRemove = null;
      if (dataSource && viewer) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
      dataManager = null;
      tiles.clear();
      roots.clear();
      shown.clear();
      wanted = [];
      centre = null;
      error = null;
      lastUpdate = null;
      credited = false;
    },

    /** Show or hide one kind: `{restaurant: false}`. */
    setParams(params = {}) {
      for (const kind of VENUE_KINDS)
        if (typeof params[kind] === 'boolean') setKind(kind, params[kind]);
      return true;
    },

    getParams() {
      return { ...kinds };
    },

    /** One chip per kind, with its colour and loaded count as the legend. */
    getRowControls() {
      const totals = counts();
      return {
        chips: VENUE_KINDS.map((kind) => {
          const label = t(KIND_LABELS[kind]);
          const on = kinds[kind];
          return {
            id: `venues-${kind}`,
            label: label.toUpperCase(),
            title: on
              ? t('Hide {category}', { category: label })
              : t('Show {category}', { category: label }),
            active: on,
            busy: false,
            disabled: false,
            state: on ? 'active' : 'idle',
            onClick: () => setKind(kind, !on),
          };
        }),
        legend: VENUE_KINDS.map((kind) => ({
          label: t(KIND_LABELS[kind]),
          color: VENUE_COLORS[kind],
          count: totals[kind],
        })),
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const out = [];
      for (const { record } of shown.values()) {
        if (!kinds[record.kind]) continue;
        out.push({ ...record });
        if (out.length >= limit) break;
      }
      return out;
    },

    getStats() {
      let count = 0;
      for (const { record } of shown.values()) if (kinds[record.kind]) count++;
      let statusMessage = null;
      if (configured === false)
        statusMessage = msg('Needs an Overpass server (OVERPASS_UPSTREAMS)');
      else if (tooHigh) statusMessage = msg('Zoom in to a city to load venues');
      else if (loading()) statusMessage = msg('Loading venues…');
      return {
        count: tooHigh ? 0 : count,
        lastUpdate,
        error: configured === false || loading() ? null : error,
        statusMessage,
      };
    },
  };
}
