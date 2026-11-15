/**
 * A box around a point that one vector-tile request can cover. Pure.
 * @module data/tileBox
 */

/** Width of a zoom-0 Web Mercator tile at the equator, in metres. */
const WORLD_WIDTH_M = 40_075_016.686;

/**
 * The box `radiusM` each way around a point, shrunk so it never spans more
 * than `tilesPerSide` tiles a side at `zoom`. Tiles narrow with latitude: a
 * fixed 5 km box over London or Hobart would need more zoom-14 tiles than
 * the tile source fetches in one request (sixteen).
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusM
 * @param {{zoom?: number, tilesPerSide?: number}} [options]
 * @returns {{south: number, north: number, west: number, east: number}}
 */
export function boxWithinTiles(
  lat,
  lon,
  radiusM,
  { zoom = 14, tilesPerSide = 4 } = {},
) {
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const tileWidthM = (WORLD_WIDTH_M / 2 ** zoom) * cosLat;
  // A box 2r wide touches at most ceil(2r / width) + 1 tiles.
  const radius = Math.min(
    radiusM,
    ((tilesPerSide - 1) / 2 - 0.05) * tileWidthM,
  );
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * cosLat);
  return {
    south: Math.max(-85, lat - dLat),
    north: Math.min(85, lat + dLat),
    west: Math.max(-180, lon - dLon),
    east: Math.min(180, lon + dLon),
  };
}
