// Venues: OpenMapTiles `poi` features become venue records, and the view
// draws the nearest of the shown kinds.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapVenuePoi,
  nearestVenues,
  venueKind,
  venueViewBox,
} from './model.js';

test('restaurants, cafés, hotels, police and fire stations are venues', () => {
  assert.equal(venueKind({ class: 'police' }), 'police');
  assert.equal(venueKind({ class: 'fire_station' }), 'fire');
  assert.equal(venueKind({ class: 'restaurant' }), 'restaurant');
  assert.equal(venueKind({ class: 'cafe', subclass: 'cafe' }), 'cafe');
  assert.equal(venueKind({ class: 'lodging', subclass: 'hotel' }), 'hotel');
  assert.equal(venueKind({ class: 'lodging', subclass: 'hostel' }), null);
  assert.equal(venueKind({ class: 'bank' }), null);
});

test('a poi maps to a record with the local name first', () => {
  const record = mapVenuePoi({
    id: '14/13723/7013:42',
    lat: 25.04,
    lon: 121.53,
    properties: {
      class: 'lodging',
      subclass: 'hotel',
      name: '華國大飯店',
      'name:en': 'Imperial Hotel',
      rank: 36,
    },
  });
  assert.deepEqual(record, {
    id: '14/13723/7013:42',
    lat: 25.04,
    lon: 121.53,
    kind: 'hotel',
    name: '華國大飯店',
    nameEn: 'Imperial Hotel',
    rank: 36,
  });
  assert.equal(mapVenuePoi({ id: 'x', properties: { class: 'cafe' } }), null);
  assert.equal(
    mapVenuePoi({ id: 'x', lat: 1, lon: 1, properties: { class: 'bank' } }),
    null,
  );
  assert.equal(
    mapVenuePoi({
      id: 'x',
      lat: 1,
      lon: 1,
      properties: { class: 'cafe', name: 'a‮b\n c' },
    }).name,
    'ab c',
    'control and bidi characters never reach a label',
  );
});

test('the loaded box widens with height and stays bounded', () => {
  const low = venueViewBox(25.04, 121.53, 300);
  const high = venueViewBox(25.04, 121.53, 12_000);
  const spanM = (box) => (box.north - box.south) * 111_320;
  assert.ok(Math.abs(spanM(low) - 1400) < 1, 'at least 700 m each way');
  assert.ok(Math.abs(spanM(high) - 5000) < 1, 'at most 2.5 km each way');
  assert.ok(low.west < 121.53 && 121.53 < low.east);
});

test('the nearest venues of the shown kinds are drawn, up to the limit', () => {
  const centre = { lat: 25.04, lon: 121.53 };
  const records = [
    { id: 'far', kind: 'cafe', lat: 25.06, lon: 121.53 },
    { id: 'near', kind: 'cafe', lat: 25.0401, lon: 121.53 },
    { id: 'hidden', kind: 'restaurant', lat: 25.04, lon: 121.53 },
    { id: 'mid', kind: 'hotel', lat: 25.045, lon: 121.53 },
  ];
  const kinds = { restaurant: false, cafe: true, hotel: true };
  assert.deepEqual(
    nearestVenues(records, centre, kinds, 2).map((record) => record.id),
    ['near', 'mid'],
  );
  // A police or fire station is drawn however many nearer venues there are.
  const station = { id: 'station', kind: 'police', lat: 25.07, lon: 121.53 };
  assert.deepEqual(
    nearestVenues([...records, station], centre, { ...kinds, police: true }, 2)
      .map((record) => record.id)
      .sort(),
    ['near', 'station'],
  );
});
