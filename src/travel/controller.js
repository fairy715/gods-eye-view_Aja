import * as Cesium from 'cesium';
import { msg } from '../i18n/index.js';
import { boxWithinTiles } from '../data/tileBox.js';
import EMERGENCY from './data/emergency.json' with { type: 'json' };
import {
  TRAVEL_CATEGORIES,
  directionArrow,
  distanceM,
  distanceText,
  nearestByCategory,
  parseLocationText,
  walkMinutes,
  zoneClock,
  zoneForPlace,
} from './model.js';

const STORAGE_KEY = 'gev.travel.v1';
const OVERLAY_SOURCE_ID = 'travel';
/** How far around the traveller places are looked for, in metres. */
export const NEARBY_RADIUS_M = 2000;
const NEARBY_ZOOM = 14;
const MAX_PINS = 30;
const MAX_CLOCKS = 8;
const TRAVELLER_COLOR = '#35e0ff';
const PIN_COLOR = '#ffd84d';
const HOME_ZONE = 'Asia/Taipei';

/** Countries the emergency card has verified numbers for. */
export const TRAVEL_COUNTRY_CODES = Object.freeze(
  Object.keys(EMERGENCY.countries),
);

function readState(storage) {
  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (stored && typeof stored === 'object') return stored;
  } catch {
    // Unreadable storage starts the panel empty.
  }
  return {};
}

const isPoint = (value) =>
  Number.isFinite(value?.lat) &&
  Number.isFinite(value?.lon) &&
  Math.abs(value.lat) <= 90 &&
  Math.abs(value.lon) <= 180;

const coordsText = ({ lat, lon }) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

/** What the emergency card shows for a country, or null when not covered. */
export function emergencyFor(code) {
  const numbers = EMERGENCY.countries[code];
  if (!numbers) return null;
  return {
    code,
    police: numbers.police,
    ambulance: numbers.ambulance,
    fire: numbers.fire,
    other: numbers.other,
    hotline: EMERGENCY.hotline.dial[code] || null,
    hotlineNumber: EMERGENCY.hotline.number,
    centre: EMERGENCY.hotline.centre,
    offices: EMERGENCY.offices.filter((office) => office.country === code),
    checkedOn: EMERGENCY.checkedOn,
  };
}

/**
 * UTILITIES ▸ Travel assist: where a traveller is (from a pasted map link or
 * coordinates), the emergency contacts of that country, the nearest police,
 * hospital, Taiwan office, cash and water with a walking route, the trip's
 * own pinned places, and clocks for the zones in play. State is kept in this
 * browser; nothing is sent anywhere except the short-link lookup.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {object} options.dataManager Layer lifecycle (for Directions).
 * @param {object} [options.navigation] Shell navigation policy.
 * @param {{fetchBounds: Function}} options.source Travel POI tile source.
 * @param {Function} options.lookupPlace `placeBelow(lat, lon)`.
 * @param {object} options.overlayHost World-overlay label host.
 * @param {Function} options.publish Receives each view object.
 * @param {Function} options.connect Connects the actions; returns disconnect.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Storage|null} [options.storage]
 * @param {Function} [options.requestRender]
 * @param {() => number} [options.now]
 */
export function initTravelAssist({
  viewer,
  dataManager,
  navigation,
  source,
  lookupPlace,
  overlayHost,
  publish,
  connect,
  fetchImpl = (...args) => globalThis.fetch(...args),
  storage = globalThis.localStorage ?? null,
  requestRender = () => {},
  now = () => Date.now(),
}) {
  const stored = readState(storage);
  let location = isPoint(stored.location)
    ? {
        lat: stored.location.lat,
        lon: stored.location.lon,
        setAt: Number(stored.location.setAt) || now(),
      }
    : null;
  let pins = Array.isArray(stored.pins)
    ? stored.pins
        .filter((pin) => isPoint(pin) && typeof pin.name === 'string')
        .slice(0, MAX_PINS)
        .map((pin) => ({
          id: String(pin.id),
          name: pin.name.slice(0, 60),
          lat: pin.lat,
          lon: pin.lon,
        }))
    : [];
  let clocks = Array.isArray(stored.clocks)
    ? stored.clocks.filter((zone) => zoneClock(zone)).slice(0, MAX_CLOCKS)
    : [HOME_ZONE];
  let countryOverride = TRAVEL_COUNTRY_CODES.includes(stored.country)
    ? stored.country
    : null;
  /** `{countryCode, country, division, near}` of the location, once known. */
  let place = null;
  let status = null;
  let nearby = { state: 'none', groups: {} };
  let destroyed = false;
  let epoch = 0;
  let loadAbort = null;
  let nextPinId =
    pins.reduce((max, pin) => Math.max(max, Number(pin.id) || 0), 0) + 1;

  const dataSource = new Cesium.CustomDataSource('travel');
  viewer.dataSources.add(dataSource);
  overlayHost.setVisible(OVERLAY_SOURCE_ID, true);

  function persist() {
    try {
      storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ location, pins, clocks, country: countryOverride }),
      );
    } catch {
      // A private window may refuse storage; the panel then lasts the session.
    }
  }

  function paintMap() {
    dataSource.entities.removeAll();
    const labels = [];
    const mark = (id, point, color, size, title, priority) => {
      const position = Cesium.Cartesian3.fromDegrees(point.lon, point.lat);
      dataSource.entities.add({
        id,
        position,
        point: {
          pixelSize: size,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      labels.push({
        id,
        position,
        variant: 'label',
        title,
        accent: color,
        priority,
        collisionGroup: 'ambient-label',
        paintLane: 'ambient-label',
        interactive: false,
        edgeFade: 'keyhole',
        horizonCull: true,
        terrainOcclusion: false,
        gapPx: 14,
        verticalOnly: true,
        placement: 'above',
      });
    };
    // The label is the traveller's own marker text, not interface copy.
    if (location)
      mark('travel:traveller', location, TRAVELLER_COLOR, 16, '★', 100);
    for (const pin of pins)
      mark(
        `travel:pin:${pin.id}`,
        pin,
        PIN_COLOR,
        11,
        pin.name.slice(0, 30),
        50,
      );
    overlayHost.setEntries(OVERLAY_SOURCE_ID, labels, {
      cohortLimit: MAX_PINS + 1,
      collisionCapacity: MAX_PINS + 1,
      moving: false,
    });
    requestRender('travel');
  }

  const relative = (target) =>
    location
      ? {
          distance: distanceText(distanceM(location, target)),
          walkMinutes: walkMinutes(distanceM(location, target)),
          arrow: directionArrow(location, target),
        }
      : null;

  function view() {
    const countryCode = countryOverride || place?.countryCode || null;
    const travellerZone = location
      ? zoneForPlace(place?.countryCode, place?.division)
      : null;
    return {
      location: location && {
        coords: coordsText(location),
        setAt: location.setAt,
        country: place?.country || null,
        division: place?.division || null,
        near: place?.near || null,
      },
      status,
      countryCode,
      countryDetected: place?.countryCode || null,
      countryOptions: TRAVEL_COUNTRY_CODES,
      emergency: countryCode ? emergencyFor(countryCode) : null,
      centre: EMERGENCY.hotline.centre,
      nearby: {
        state: nearby.state,
        radius: distanceText(NEARBY_RADIUS_M),
        groups: TRAVEL_CATEGORIES.map((category) => ({
          category,
          items: (nearby.groups[category] || []).map((poi) => ({
            id: poi.id,
            name: poi.name,
            ...relative(poi),
          })),
        })),
      },
      pins: pins.map((pin) => ({
        id: pin.id,
        name: pin.name,
        coords: coordsText(pin),
        ...relative(pin),
      })),
      clocks: [
        ...clocks.map((zone) => ({ zone, traveller: zone === travellerZone })),
        ...(travellerZone && !clocks.includes(travellerZone)
          ? [{ zone: travellerZone, traveller: true, auto: true }]
          : []),
      ],
      homeZone: clocks[0] || HOME_ZONE,
    };
  }

  function present() {
    if (!destroyed) publish(view());
  }

  function flyTo(point, height = 1200) {
    const fly = () =>
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          point.lon,
          point.lat,
          height,
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 1.5,
      });
    if (typeof navigation?.runImmediateNavigation === 'function')
      return navigation.runImmediateNavigation('location', fly) !== false;
    fly();
    return true;
  }

  async function loadNearby(at, mine) {
    loadAbort?.abort();
    loadAbort = new AbortController();
    const { signal } = loadAbort;
    nearby = { state: 'loading', groups: {} };
    present();
    try {
      const box = boxWithinTiles(at.lat, at.lon, NEARBY_RADIUS_M, {
        zoom: NEARBY_ZOOM,
      });
      const result = await source.fetchBounds(box, {
        zoom: NEARBY_ZOOM,
        signal,
      });
      if (signal.aborted || mine !== epoch) return;
      const pois = result.tiles.flatMap((tile) => tile?.pois || []);
      const groups = nearestByCategory(pois, at);
      // A tile holds more ground than the box: keep what is within reach.
      for (const category of Object.keys(groups))
        groups[category] = groups[category].filter(
          (poi) => poi.distanceM <= NEARBY_RADIUS_M,
        );
      nearby = { state: 'ready', groups };
    } catch (error) {
      if (signal.aborted || mine !== epoch) return;
      console.warn('[Travel] nearby places failed:', error?.message || error);
      nearby = { state: 'error', groups: {} };
    }
    present();
  }

  async function describe(at, mine) {
    try {
      const below = await lookupPlace(at.lat, at.lon);
      if (mine !== epoch) return;
      place =
        below?.kind === 'country'
          ? {
              countryCode: below.countryCode,
              country: below.name,
              division: below.division || null,
              near: below.near || null,
            }
          : null;
    } catch {
      if (mine !== epoch) return;
      place = null;
    }
    present();
  }

  function applyLocation(point, { fly = true } = {}) {
    epoch += 1;
    location = { lat: point.lat, lon: point.lon, setAt: now() };
    place = null;
    status = null;
    persist();
    paintMap();
    present();
    if (fly) flyTo(location);
    void describe(location, epoch);
    void loadNearby(location, epoch);
  }

  /** Read a pasted link or coordinates; a short link is followed first. */
  async function readLocation(text) {
    const parsed = parseLocationText(text);
    if (!parsed) return null;
    if (!parsed.shortLink) return parsed;
    const response = await fetchImpl(
      `/api/travel/resolve?url=${encodeURIComponent(parsed.shortLink)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(`resolve_${response.status}`);
    const body = await response.json();
    for (const url of [...(body?.urls || [])].reverse()) {
      const found = parseLocationText(url);
      if (found && !found.shortLink) return found;
    }
    return null;
  }

  async function resolveInto(text, apply) {
    status = { kind: 'busy', text: msg('Reading the location…') };
    present();
    let point = null;
    let failed = false;
    try {
      point = await readLocation(text);
    } catch {
      failed = true;
    }
    if (destroyed) return false;
    if (!point) {
      status = {
        kind: 'error',
        text: failed
          ? msg('The short link could not be opened')
          : msg('No location found in that text'),
      };
      present();
      return false;
    }
    status = null;
    apply(point);
    return true;
  }

  function targetOf(id) {
    if (String(id).startsWith('pin:'))
      return pins.find((pin) => `pin:${pin.id}` === id) || null;
    for (const items of Object.values(nearby.groups)) {
      const found = items.find((poi) => poi.id === id);
      if (found) return found;
    }
    return null;
  }

  const actions = {
    setTravelLocation: (text) =>
      resolveInto(text, (point) => applyLocation(point)),

    clearTravelLocation() {
      epoch += 1;
      loadAbort?.abort();
      location = null;
      place = null;
      status = null;
      nearby = { state: 'none', groups: {} };
      persist();
      paintMap();
      present();
    },

    flyToTraveller() {
      if (location) flyTo(location);
    },

    setTravelCountry(code) {
      countryOverride = TRAVEL_COUNTRY_CODES.includes(code) ? code : null;
      persist();
      present();
    },

    flyToTravelPlace(id) {
      const target = targetOf(id);
      if (target) flyTo(target, 800);
    },

    /** Draw the walking route from the traveller to a listed place. */
    async routeToTravelPlace(id) {
      const target = targetOf(id);
      const directions = dataManager?.layers?.get('directions')?.module;
      if (!location || !target || !directions?.placeEndpoint) return false;
      await dataManager.setEnabled('directions', true, { origin: 'user' });
      if (destroyed || !dataManager.isEnabled('directions')) return false;
      directions.setParams({ clear: true });
      directions.setParams({ mode: 'foot' });
      directions.placeEndpoint('a', { lat: location.lat, lon: location.lon });
      directions.placeEndpoint('b', { lat: target.lat, lon: target.lon });
      return true;
    },

    addTravelPin: (name, text) =>
      resolveInto(text, (point) => {
        if (pins.length >= MAX_PINS) return;
        const label = String(name || '')
          .trim()
          .slice(0, 60);
        pins = [
          ...pins,
          {
            id: String(nextPinId++),
            name: label || coordsText(point),
            lat: point.lat,
            lon: point.lon,
          },
        ];
        persist();
        paintMap();
        present();
      }),

    removeTravelPin(id) {
      pins = pins.filter((pin) => pin.id !== id);
      persist();
      paintMap();
      present();
    },

    addTravelClock(zone) {
      if (
        !zoneClock(zone) ||
        clocks.includes(zone) ||
        clocks.length >= MAX_CLOCKS
      )
        return;
      clocks = [...clocks, zone];
      persist();
      present();
    },

    removeTravelClock(zone) {
      clocks = clocks.filter((entry) => entry !== zone);
      persist();
      present();
    },
  };

  const disconnect = connect(actions);
  paintMap();
  present();
  if (location) {
    void describe(location, epoch);
    void loadNearby(location, epoch);
  }

  return {
    /** The current view object (tests and tools). */
    getView: view,
    actions,
    destroy() {
      destroyed = true;
      epoch += 1;
      loadAbort?.abort();
      disconnect?.();
      overlayHost.clearSource(OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OVERLAY_SOURCE_ID, false);
      viewer.dataSources.remove(dataSource, true);
    },
  };
}
