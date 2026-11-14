// Venues: tile arithmetic, record mapping, and the combined-preset query the
// layer asks the server for.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VENUE_MAX_LEVEL,
  VENUE_PRESET,
  mapVenueFeature,
  venueKind,
  venueTileBox,
  venueTileChildren,
  venueTileKey,
  venueTilesAround,
} from './model.js';
import { compileOsmFeatureQuery } from '../../../server/providers/overpass/osmFeatures.js';

test('a point sits inside the box of its own tile, and quarters tile the parent', () => {
  const key = venueTileKey(25.0478, 121.5319);
  const [west, south, east, north] = venueTileBox(key);
  assert.ok(west <= 121.5319 && 121.5319 < east);
  assert.ok(south <= 25.0478 && 25.0478 < north);
  const children = venueTileChildren(key);
  assert.equal(children.length, 4);
  const boxes = children.map(venueTileBox);
  assert.equal(Math.min(...boxes.map((box) => box[0])), west);
  assert.equal(Math.max(...boxes.map((box) => box[3])), north);
  let deepest = key;
  for (let level = 0; level < VENUE_MAX_LEVEL; level += 1)
    [deepest] = venueTileChildren(deepest);
  assert.deepEqual(venueTileChildren(deepest), [], 'subdivision is bounded');
});

test('the view loads its own tile first, then the ring around it', () => {
  const tiles = venueTilesAround(25.0478, 121.5319, 1);
  assert.equal(tiles.length, 9);
  assert.equal(tiles[0], venueTileKey(25.0478, 121.5319));
  assert.equal(new Set(tiles).size, 9);
  assert.deepEqual(venueTilesAround(NaN, 0), []);
  // The ring wraps across the antimeridian rather than leaving the globe.
  assert.equal(venueTilesAround(0, 179.99, 1).length, 9);
});

test('features map to the three kinds, with the local name first', () => {
  assert.equal(venueKind({ amenity: 'cafe' }), 'cafe');
  assert.equal(venueKind({ tourism: 'hotel' }), 'hotel');
  assert.equal(venueKind({ amenity: 'bank' }), null);
  const record = mapVenueFeature({
    id: 'node/1',
    lat: 25.04,
    lon: 121.53,
    tags: {
      amenity: 'restaurant',
      name: '鼎泰豐',
      'name:en': 'Din Tai Fung',
      cuisine: 'chinese;dumpling',
      'addr:street': '信義路二段',
      'addr:housenumber': '194',
    },
  });
  assert.equal(record.kind, 'restaurant');
  assert.equal(record.name, '鼎泰豐');
  assert.equal(record.nameEn, 'Din Tai Fung');
  assert.equal(record.cuisine, 'chinese, dumpling');
  assert.equal(record.address, '信義路二段 194');
  assert.equal(mapVenueFeature({ id: 'node/2', tags: {} }), null);
  assert.equal(
    mapVenueFeature({
      id: 'node/3',
      lat: 1,
      lon: 1,
      tags: { amenity: 'bank' },
    }),
    null,
  );
});

test('one request searches a tile for all three kinds, from curated presets only', () => {
  const compiled = compileOsmFeatureQuery({
    preset: VENUE_PRESET,
    bbox: venueTileBox(venueTileKey(25.0478, 121.5319)),
    limit: 1000,
  });
  assert.equal(compiled.ok, true);
  assert.match(compiled.ql, /nwr\["amenity"="restaurant"\]/);
  assert.match(compiled.ql, /nwr\["amenity"="cafe"\]/);
  assert.match(compiled.ql, /nwr\["tourism"="hotel"\]/);
  for (const preset of ['restaurant,nope', 'cafe,cafe', 'a,b,c,d,e', ','])
    assert.equal(
      compileOsmFeatureQuery({ preset, bbox: [0, 0, 1, 1] }).code,
      'UNKNOWN_PRESET',
      preset,
    );
});
