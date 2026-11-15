import {
  createOpenFreeMapSource,
  registerOpenFreeMapProjection,
} from './openFreeMap.js';
import { mapVenuePoi, venueKind } from '../layers/venues/model.js';

/**
 * Restaurants, cafés, hotels, police and fire stations from the `poi` layer of an OpenFreeMap
 * (OpenMapTiles schema) tile. The same tiles carry the roads Street Traffic
 * draws, so a view that shows both downloads each tile once.
 * @returns {{venues: object[]}}
 */
export function decodeOpenFreeMapVenueTile(bytes, z, x, y, tile) {
  const layer = tile?.layers?.poi;
  const venues = [];
  if (!layer) return { venues };
  if (layer.length > 40_000)
    throw new Error('Vector tile feature limit exceeded');
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const props = feature.properties;
    // Skip the geometry of the thousands of other points of interest.
    if (!venueKind(props)) continue;
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
    const venue = mapVenuePoi({
      id: `${z}/${x}/${y}:${feature.id ?? `i${i}`}`,
      lon: point[0],
      lat: point[1],
      properties: props,
    });
    if (venue) venues.push(venue);
  }
  return { venues };
}

registerOpenFreeMapProjection('venues', decodeOpenFreeMapVenueTile);

/** Construct the venue tile source: the shared OpenFreeMap tiles, `poi` decode. */
export function createOpenFreeMapVenueSource(options = {}) {
  return createOpenFreeMapSource({
    projection: 'venues',
    maxEntries: 48,
    maxCacheBytes: 8 * 1024 * 1024,
    ...options,
  });
}
