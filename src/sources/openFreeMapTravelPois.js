import {
  createOpenFreeMapSource,
  registerOpenFreeMapProjection,
} from './openFreeMap.js';
import { travelPoiCategory } from '../travel/model.js';

/** Longest name kept; OSM names are open text. */
const MAX_NAME = 80;

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/(?![‌‍])\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? Array.from(text).slice(0, MAX_NAME).join('') : null;
}

/**
 * The places a stranded traveller needs — police, hospitals, pharmacies,
 * banks, cash machines, stations, water, toilets, libraries and Taiwan's
 * representative offices — from the `poi` layer of an OpenFreeMap tile.
 * @returns {{pois: object[]}}
 */
export function decodeOpenFreeMapTravelTile(bytes, z, x, y, tile) {
  const layer = tile?.layers?.poi;
  const pois = [];
  if (!layer) return { pois };
  if (layer.length > 40_000)
    throw new Error('Vector tile feature limit exceeded');
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const props = feature.properties;
    const category = travelPoiCategory(props);
    if (!category) continue;
    // A tile repeats the points in its buffer; they belong to its neighbour.
    const at = feature.loadGeometry()[0]?.[0];
    if (
      !at ||
      at.x < 0 ||
      at.y < 0 ||
      at.x >= feature.extent ||
      at.y >= feature.extent
    )
      continue;
    const geometry = feature.toGeoJSON(x, y, z).geometry;
    const point =
      geometry.type === 'Point'
        ? geometry.coordinates
        : geometry.type === 'MultiPoint'
          ? geometry.coordinates[0]
          : null;
    if (!point) continue;
    pois.push({
      id: `${z}/${x}/${y}:${feature.id ?? `i${i}`}`,
      category,
      lon: point[0],
      lat: point[1],
      name: cleanName(props.name) || cleanName(props['name:en']),
    });
  }
  return { pois };
}

registerOpenFreeMapProjection('travel-pois', decodeOpenFreeMapTravelTile);

/** Construct the travel tile source: the shared OpenFreeMap tiles, `poi` decode. */
export function createOpenFreeMapTravelSource(options = {}) {
  return createOpenFreeMapSource({
    projection: 'travel-pois',
    maxEntries: 32,
    maxCacheBytes: 4 * 1024 * 1024,
    ...options,
  });
}
