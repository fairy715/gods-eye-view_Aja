/**
 * Venues: restaurants, cafés and hotels from OpenStreetMap, read from the
 * `poi` layer of OpenFreeMap vector tiles. Pure — record mapping and view
 * arithmetic, no Cesium.
 * @module layers/venues/model
 */

export const VENUES_LAYER_ID = 'venues';

/** The kinds drawn, in panel order. */
export const VENUE_KINDS = Object.freeze(['restaurant', 'cafe', 'hotel']);

export const VENUE_COLORS = Object.freeze({
  restaurant: '#ff9f43',
  cafe: '#c8a27a',
  hotel: '#b388ff',
});

/** OpenFreeMap serves points of interest at its deepest zoom only. */
export const VENUE_TILE_ZOOM = 14;

/** Longest name kept; OSM names are open text. */
const MAX_TEXT = 120;

function text(value) {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/(?![‌‍])\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  const chars = Array.from(clean);
  return chars.length <= MAX_TEXT
    ? clean
    : `${chars
        .slice(0, MAX_TEXT - 1)
        .join('')
        .trimEnd()}…`;
}

/**
 * Which venue kind an OpenMapTiles `poi` feature is, or null. `lodging`
 * also covers hostels, guest houses and camp sites; only hotels are drawn.
 * @param {{class?: string, subclass?: string}} properties
 */
export function venueKind(properties = {}) {
  if (properties.class === 'restaurant') return 'restaurant';
  if (properties.class === 'cafe') return 'cafe';
  if (properties.class === 'lodging' && properties.subclass === 'hotel')
    return 'hotel';
  return null;
}

/**
 * One `poi` feature → a venue record, or null when it has no usable position
 * or is not one of the three kinds.
 * @param {{id: string, lat: number, lon: number, properties?: object}} poi
 */
export function mapVenuePoi(poi) {
  if (!Number.isFinite(poi?.lat) || !Number.isFinite(poi?.lon)) return null;
  const props = poi.properties || {};
  const kind = venueKind(props);
  if (!kind) return null;
  const rank = Number(props.rank);
  return {
    id: String(poi.id),
    lat: poi.lat,
    lon: poi.lon,
    kind,
    // The local name first: it is what the sign on the street says.
    name: text(props.name) || text(props['name:en']),
    nameEn: text(props['name:en']),
    // OpenMapTiles importance within the tile; lower is more prominent.
    rank: Number.isFinite(rank) ? rank : null,
  };
}

/**
 * The box loaded around the view centre: wider from higher up, capped so a
 * dense city stays a few tiles.
 * @param {number} lat
 * @param {number} lon
 * @param {number} cameraHeightM
 * @returns {{south: number, north: number, west: number, east: number}}
 */
export function venueViewBox(lat, lon, cameraHeightM) {
  const radiusM = Math.min(2500, Math.max(700, cameraHeightM * 1.2));
  const dLat = radiusM / 111_320;
  const dLon =
    radiusM / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return {
    south: Math.max(-85, lat - dLat),
    north: Math.min(85, lat + dLat),
    west: Math.max(-180, lon - dLon),
    east: Math.min(180, lon + dLon),
  };
}

/** Approximate ground distance in metres; enough to rank by nearness. */
export function venueDistanceM(a, b) {
  const toRad = Math.PI / 180;
  const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.hypot(x, y) * 6_371_000;
}

/**
 * The venues to draw: those of the shown kinds nearest the centre, up to a
 * limit, so a district with thousands of restaurants stays drawable.
 * @param {Iterable<object>} records
 * @param {{lat: number, lon: number}} centre
 * @param {Record<string, boolean>} kinds
 * @param {number} limit
 * @returns {object[]} Nearest first.
 */
export function nearestVenues(records, centre, kinds, limit) {
  const ranked = [];
  for (const record of records)
    if (kinds[record.kind])
      ranked.push({ record, distance: venueDistanceM(centre, record) });
  ranked.sort((a, b) => a.distance - b.distance);
  return ranked.slice(0, limit).map(({ record }) => record);
}
