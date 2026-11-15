import * as Cesium from 'cesium';
import { t, msg } from '../../i18n/index.js';
import {
  VENUES_LAYER_ID,
  VENUE_COLORS,
  VENUE_KINDS,
  VENUE_TILE_ZOOM,
  nearestVenues,
  venueViewBox,
} from './model.js';
export * from './model.js';

const OVERLAY_SOURCE_ID = VENUES_LAYER_ID;
/** Named venues nearest the view centre that get a map label. */
const LABEL_LIMIT = 40;
/** Venues drawn at once, nearest the view centre first. */
const DRAW_LIMIT = 2500;
/** Above this camera height the layer neither loads nor draws. */
const MAX_CAMERA_HEIGHT_M = 15_000;
/** Decoded tiles kept in memory; the least recently viewed go first. */
const MAX_TILES = 40;
const CAMERA_DEBOUNCE_MS = 350;
const RETRY_MS = 15_000;

const KIND_LABELS = Object.freeze({
  restaurant: msg('Restaurants'),
  cafe: msg('Cafés'),
  hotel: msg('Hotels'),
  police: msg('Police'),
  fire: msg('Fire Stations'),
});

/**
 * Restaurants, cafés, hotels, police and fire stations around the point the camera looks at, from
 * OpenStreetMap as published in OpenFreeMap vector tiles — keyless, and the
 * same tiles Street Traffic reads its roads from. Tiles are decoded once and
 * kept; the venues nearest the view centre are drawn, up to a limit. Nothing
 * loads from high altitude, where a city is a single dot.
 *
 * @param {object} options
 * @param {object} options.overlayHost World-overlay label host.
 * @param {{fetchBounds: Function}} options.source Venue tile source.
 * @param {Function} [options.requestRender] Asks the scene for a frame.
 * @param {Function} [options.onCredit] Called once when venues first show.
 */
export function createVenuesLayer({
  overlayHost,
  source,
  requestRender = () => {},
  onCredit = () => {},
} = {}) {
  if (!overlayHost) throw new TypeError('Venues requires an overlay host');
  if (typeof source?.fetchBounds !== 'function')
    throw new TypeError('Venues requires a venue tile source');

  let viewer = null;
  let dataSource = null;
  let dataManager = null;
  let enabled = false;
  let moveEndRemove = null;
  let debounceTimer = null;
  let retryTimer = null;
  let abort = null;
  let loading = false;
  let credited = false;
  let tooHigh = false;
  let error = null;
  let lastUpdate = null;
  let centre = null;
  /** `z/x/y` → venue records of that tile, in viewing order. */
  const tiles = new Map();
  /** Record id → {record, entity} of what is drawn now. */
  const shown = new Map();
  /** Tiles of the current view; their venues are what the row counts. */
  let viewKeys = [];
  const kinds = Object.fromEntries(VENUE_KINDS.map((kind) => [kind, true]));

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

  function* viewRecords() {
    for (const key of viewKeys) yield* tiles.get(key) || [];
  }

  function paintLabels() {
    if (!enabled || tooHigh || !centre) {
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      return;
    }
    // `shown` is already nearest-first.
    const entries = [];
    for (const { record } of shown.values()) {
      if (!record.name) continue;
      entries.push({
        id: record.id,
        position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat),
        variant: 'label',
        title: record.name.slice(0, 40),
        accent: VENUE_COLORS[record.kind],
        priority: LABEL_LIMIT - entries.length,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 12,
        verticalOnly: true,
        placement: 'above',
      });
      if (entries.length >= LABEL_LIMIT) break;
    }
    overlayHost.setEntries(OVERLAY_SOURCE_ID, entries, {
      cohortLimit: LABEL_LIMIT,
      collisionCapacity: LABEL_LIMIT,
      moving: false,
    });
  }

  /** Draw the venues nearest the centre; keep the entities that stay. */
  function draw() {
    if (!dataSource) return;
    const next =
      enabled && !tooHigh && centre
        ? nearestVenues(viewRecords(), centre, kinds, DRAW_LIMIT)
        : [];
    const keep = new Set(next.map((record) => record.id));
    for (const [id, held] of shown) {
      if (keep.has(id)) continue;
      dataSource.entities.remove(held.entity);
      shown.delete(id);
    }
    const ordered = new Map();
    for (const record of next) {
      const held = shown.get(record.id) || {
        record,
        entity: dataSource.entities.add({
          id: `venue:${record.id}`,
          name: record.name || t(KIND_LABELS[record.kind]),
          position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat),
          point: {
            pixelSize: 8,
            color: colors[record.kind],
            outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            // On top only up close; beyond that the depth test keeps
            // far-side points from showing through buildings and terrain.
            disableDepthTestDistance: 2500,
          },
        }),
      };
      ordered.set(record.id, held);
    }
    shown.clear();
    for (const [id, held] of ordered) shown.set(id, held);
    if (!credited && shown.size) {
      credited = true;
      onCredit(viewer);
    }
    paintLabels();
    refreshRow();
  }

  function evictTiles() {
    const keep = new Set(viewKeys);
    for (const key of tiles.keys()) {
      if (tiles.size <= MAX_TILES) break;
      if (!keep.has(key)) tiles.delete(key);
    }
  }

  async function load(box) {
    abort?.abort();
    abort = new AbortController();
    const { signal } = abort;
    clearTimeout(retryTimer);
    loading = true;
    refreshRow();
    try {
      const result = await source.fetchBounds(box, {
        zoom: VENUE_TILE_ZOOM,
        signal,
        onTile(value, tile) {
          if (signal.aborted) return;
          const key = `${tile.z}/${tile.x}/${tile.y}`;
          // Viewing a tile again makes it the most recently used.
          tiles.delete(key);
          tiles.set(key, value?.venues || []);
          if (!viewKeys.includes(key)) viewKeys.push(key);
          draw();
        },
      });
      if (signal.aborted) return;
      viewKeys = result.loadedTiles.map(
        (tile) => `${tile.z}/${tile.x}/${tile.y}`,
      );
      error = result.partial ? msg('Some venue tiles did not load') : null;
      lastUpdate = Date.now();
      evictTiles();
      if (result.partial) retryTimer = setTimeout(refreshView, RETRY_MS);
    } catch (cause) {
      if (signal.aborted) return;
      error = msg('Venue tiles unavailable');
      console.warn('[Data] venues tile load failed:', cause?.message || cause);
      retryTimer = setTimeout(refreshView, RETRY_MS);
    } finally {
      if (!signal.aborted) {
        loading = false;
        draw();
      }
    }
  }

  function refreshView() {
    if (!enabled || !viewer) return;
    const height = cameraHeight();
    tooHigh = height > MAX_CAMERA_HEIGHT_M;
    if (dataSource) dataSource.show = !tooHigh;
    centre = viewCentre();
    if (tooHigh || !centre) {
      abort?.abort();
      loading = false;
      viewKeys = [];
      draw();
      return;
    }
    draw();
    load(venueViewBox(centre.lat, centre.lon, height));
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
    loading = false;
  }

  function setKind(kind, on) {
    if (!Object.hasOwn(kinds, kind)) return;
    kinds[kind] = Boolean(on);
    draw();
  }

  function counts() {
    const out = Object.fromEntries(VENUE_KINDS.map((kind) => [kind, 0]));
    for (const record of viewRecords()) out[record.kind] += 1;
    return out;
  }

  return {
    id: VENUES_LAYER_ID,
    name: 'Dining, Hotels & Emergency Services',
    icon: '🍽',
    source: 'OpenStreetMap',
    updateInterval: 0,
    statsRefreshInterval: 1000,

    attachDataManager(manager) {
      dataManager = manager;
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
      draw();
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
      shown.clear();
      viewKeys = [];
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
      if (!enabled || !centre) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return nearestVenues(viewRecords(), centre, kinds, limit).map(
        (record) => ({ ...record }),
      );
    },

    getStats() {
      let count = 0;
      for (const record of viewRecords()) if (kinds[record.kind]) count++;
      let statusMessage = null;
      if (tooHigh) statusMessage = msg('Zoom in to a city to load venues');
      else if (loading) statusMessage = msg('Loading venues…');
      return {
        count: tooHigh ? 0 : count,
        lastUpdate,
        error: loading ? null : error,
        statusMessage,
      };
    },
  };
}
