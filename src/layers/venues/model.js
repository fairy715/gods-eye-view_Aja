/**
 * Venues: restaurants, cafés and hotels from OpenStreetMap, loaded for the
 * ground in view. Pure — tile arithmetic and record mapping, no Cesium.
 * @module layers/venues/model
 */

export const VENUES_LAYER_ID = 'venues';

/** The kinds drawn, in panel order, each with the OSM preset it is fetched by. */
export const VENUE_KINDS = Object.freeze(['restaurant', 'cafe', 'hotel']);

export const VENUE_COLORS = Object.freeze({
  restaurant: '#ff9f43',
  cafe: '#c8a27a',
  hotel: '#b388ff',
});

/** Preset ids sent to `/api/osm/features`, one request for all three kinds. */
export const VENUE_PRESET = VENUE_KINDS.join(',');

/** Side of a level-0 tile in degrees (~4.4 km north-south). */
export const VENUE_TILE_DEG = 0.04;
/** A truncated tile is refetched as quarters, down to this level. */
export const VENUE_MAX_LEVEL = 2;
/** Features asked for per tile; the server caps this too. */
export const VENUE_TILE_LIMIT = 1000;

/** Longest tag value kept; OSM text is open text. */
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

const tileSize = (level) => VENUE_TILE_DEG / 2 ** level;

/** `level/x/y` of the tile holding a point. */
export function venueTileKey(lat, lon, level = 0) {
  const size = tileSize(level);
  return `${level}/${Math.floor((lon + 180) / size)}/${Math.floor((lat + 90) / size)}`;
}

/** A tile's box as `[west, south, east, north]`, the order the route takes. */
export function venueTileBox(key) {
  const [level, x, y] = key.split('/').map(Number);
  const size = tileSize(level);
  const round = (value) => Number(value.toFixed(6));
  return [
    round(x * size - 180),
    round(y * size - 90),
    round((x + 1) * size - 180),
    round((y + 1) * size - 90),
  ];
}

/** The four quarter tiles of a tile, or none once the deepest level is reached. */
export function venueTileChildren(key) {
  const [level, x, y] = key.split('/').map(Number);
  if (level >= VENUE_MAX_LEVEL) return [];
  const children = [];
  for (const dx of [0, 1])
    for (const dy of [0, 1])
      children.push(`${level + 1}/${x * 2 + dx}/${y * 2 + dy}`);
  return children;
}

/**
 * Level-0 tiles within `radius` tiles of a point, nearest first, so the
 * ground under the crosshair loads before its surroundings.
 * @param {number} lat
 * @param {number} lon
 * @param {number} [radius]
 * @returns {string[]}
 */
export function venueTilesAround(lat, lon, radius = 1) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const columns = Math.round(360 / VENUE_TILE_DEG);
  const rows = Math.round(180 / VENUE_TILE_DEG);
  const cx = Math.floor((lon + 180) / VENUE_TILE_DEG);
  const cy = Math.floor((lat + 90) / VENUE_TILE_DEG);
  const tiles = [];
  for (let dx = -radius; dx <= radius; dx += 1)
    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = cy + dy;
      if (y < 0 || y >= rows) continue;
      // Wrap across the antimeridian.
      const x = (((cx + dx) % columns) + columns) % columns;
      tiles.push({ key: `0/${x}/${y}`, rank: Math.abs(dx) + Math.abs(dy) });
    }
  return tiles.sort((a, b) => a.rank - b.rank).map((tile) => tile.key);
}

/** Which venue kind a feature's tags name, or null. */
export function venueKind(tags = {}) {
  if (tags.amenity === 'restaurant') return 'restaurant';
  if (tags.amenity === 'cafe') return 'cafe';
  if (tags.tourism === 'hotel') return 'hotel';
  return null;
}

/**
 * One feature from `/api/osm/features` → a venue record, or null when it has
 * no usable position or is not one of the three kinds.
 * @param {{id: string, lat: number, lon: number, tags?: object}} feature
 */
export function mapVenueFeature(feature) {
  if (!Number.isFinite(feature?.lat) || !Number.isFinite(feature?.lon))
    return null;
  const tags = feature.tags || {};
  const kind = venueKind(tags);
  if (!kind) return null;
  const street = [text(tags['addr:street']), text(tags['addr:housenumber'])]
    .filter(Boolean)
    .join(' ');
  return {
    id: String(feature.id),
    lat: feature.lat,
    lon: feature.lon,
    kind,
    // The local name first: it is what the sign on the street says.
    name: text(tags.name) || text(tags['name:en']),
    nameEn: text(tags['name:en']),
    operator: text(tags.brand) || text(tags.operator),
    cuisine: text(tags.cuisine)?.replace(/_/g, ' ').replace(/;/g, ', ') || null,
    stars: text(tags.stars),
    openingHours: text(tags.opening_hours),
    address: street || null,
    city: text(tags['addr:city']),
    phone: text(tags.phone),
    website: text(tags.website),
  };
}

/** Approximate ground distance in metres; enough to rank labels. */
export function venueDistanceM(a, b) {
  const toRad = Math.PI / 180;
  const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.hypot(x, y) * 6_371_000;
}
