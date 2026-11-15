// Travel assist: a pasted link or coordinates becomes a position, the
// nearest help is ranked, and a place maps to its clock.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directionArrow,
  distanceText,
  nearestByCategory,
  offsetDifferenceText,
  parseLocationText,
  travelPoiCategory,
  walkMinutes,
  zoneCity,
  zoneClock,
  zoneForPlace,
} from './model.js';

const BRISBANE = { lat: -27.4698, lon: 153.0251 };

test('map links and coordinates are read as a position', () => {
  const cases = [
    '-27.4698, 153.0251',
    '-27.4698 153.0251',
    '(−27.4698, 153.0251)',
    'https://maps.google.com/?q=-27.4698,153.0251',
    'https://www.google.com/maps/search/?api=1&query=-27.4698%2C153.0251',
    'https://www.google.com/maps/search/-27.469800,+153.025100?entry=tts',
    'https://www.google.com/maps/@-27.4698,153.0251,17z',
    'https://maps.apple.com/?ll=-27.4698,153.0251&q=Dropped%20Pin',
    'https://www.openstreetmap.org/?mlat=-27.4698&mlon=153.0251#map=17/1/2',
    'https://www.openstreetmap.org/#map=17/-27.4698/153.0251',
    'geo:-27.4698,153.0251?z=17',
    // Longitude first: only the other order is a place on Earth.
    '153.0251, -27.4698',
  ];
  for (const text of cases)
    assert.deepEqual(parseLocationText(text), BRISBANE, text);
});

test('a place link gives the pin, not the centre of the map around it', () => {
  assert.deepEqual(
    parseLocationText(
      'https://www.google.com/maps/place/Riparian+Plaza/@-27.4689,153.0301,17z/data=!3m1!4b1!4m6!3m5!1s0x6b91!8m2!3d-27.468912!4d153.030112!16s',
    ),
    { lat: -27.468912, lon: 153.030112 },
  );
});

test('degrees, minutes and seconds are read with their hemispheres', () => {
  const found = parseLocationText('27°28\'11.3"S 153°01\'30.4"E');
  assert.ok(Math.abs(found.lat - -27.469806) < 1e-5);
  assert.ok(Math.abs(found.lon - 153.025111) < 1e-5);
});

test('a short link is handed back to be followed, and nonsense is refused', () => {
  assert.deepEqual(
    parseLocationText(
      '看這裡 https://maps.app.goo.gl/AbCdEf123?g_st=il 我在這',
    ),
    { shortLink: 'https://maps.app.goo.gl/AbCdEf123?g_st=il' },
  );
  assert.deepEqual(parseLocationText('https://goo.gl/maps/xyz'), {
    shortLink: 'https://goo.gl/maps/xyz',
  });
  for (const text of [
    '',
    'hello',
    'https://example.com/',
    '0,0',
    '91, 181',
    '12',
    'x'.repeat(5000),
  ])
    assert.equal(parseLocationText(text), null, text.slice(0, 20));
});

test('poi features map to the help a traveller needs', () => {
  const category = (properties) => travelPoiCategory(properties);
  assert.equal(category({ class: 'police' }), 'police');
  assert.equal(
    category({ class: 'hospital', subclass: 'hospital' }),
    'hospital',
  );
  assert.equal(category({ class: 'hospital', subclass: 'clinic' }), null);
  assert.equal(category({ class: 'atm' }), 'atm');
  assert.equal(category({ class: 'ferry_terminal' }), 'station');
  assert.equal(category({ class: 'bus', subclass: 'bus_stop' }), null);
  assert.equal(
    category({
      class: 'office',
      subclass: 'diplomatic',
      name: 'Taipei Economic and Cultural Office',
    }),
    'taiwanOffice',
  );
  assert.equal(
    category({
      class: 'office',
      subclass: 'diplomatic',
      name: '駐日代表處',
      'name:en': 'x',
      'name:zh': '台北駐日經濟文化代表處',
    }),
    'taiwanOffice',
  );
  assert.equal(
    category({
      class: 'office',
      subclass: 'diplomatic',
      name: 'British Consulate',
    }),
    null,
  );
  assert.equal(category({ class: 'restaurant' }), null);
});

test('the nearest few of each category come first, without repeats', () => {
  const pois = [
    { id: 'far', category: 'police', lat: -27.48, lon: 153.0251 },
    { id: 'near', category: 'police', lat: -27.4699, lon: 153.0251 },
    { id: 'near', category: 'police', lat: -27.4699, lon: 153.0251 },
    { id: 'bank', category: 'bank', lat: -27.4698, lon: 153.0261 },
    { id: 'other', category: 'cinema', lat: -27.4698, lon: 153.0251 },
  ];
  const groups = nearestByCategory(pois, BRISBANE, 1);
  assert.deepEqual(
    groups.police.map((poi) => poi.id),
    ['near'],
  );
  assert.ok(Math.abs(groups.police[0].distanceM - 11) < 1);
  assert.equal(groups.bank.length, 1);
  assert.deepEqual(groups.hospital, []);
  assert.equal(groups.cinema, undefined);
});

test('distances, directions and walking times read plainly', () => {
  assert.equal(distanceText(4), '10 m');
  assert.equal(distanceText(345), '350 m');
  assert.equal(distanceText(1234), '1.2 km');
  assert.equal(distanceText(12_345), '12 km');
  assert.equal(walkMinutes(10), 1);
  assert.equal(walkMinutes(800), 13);
  const at = (lat, lon) => ({
    lat: BRISBANE.lat + lat,
    lon: BRISBANE.lon + lon,
  });
  assert.equal(directionArrow(BRISBANE, at(0.01, 0)), '↑');
  assert.equal(directionArrow(BRISBANE, at(0, 0.01)), '→');
  assert.equal(directionArrow(BRISBANE, at(-0.01, 0)), '↓');
  assert.equal(directionArrow(BRISBANE, at(0.01, -0.0113)), '↖');
});

test('a place gives its zone, and a zone its clock', () => {
  assert.equal(zoneForPlace('AU', 'Queensland'), 'Australia/Brisbane');
  assert.equal(zoneForPlace('AU', 'Western Australia'), 'Australia/Perth');
  // Several zones and an unlisted division: chosen by hand, not guessed.
  assert.equal(zoneForPlace('AU', null), null);
  assert.equal(zoneForPlace('JP', 'Tokyo'), 'Asia/Tokyo');
  assert.equal(zoneForPlace('US', 'California'), null);
  assert.equal(zoneForPlace(null), null);
  assert.equal(zoneCity('America/Argentina/Buenos_Aires'), 'Buenos Aires');

  const at = Date.UTC(2026, 10, 15, 4, 30);
  const brisbane = zoneClock('Australia/Brisbane', at);
  const taipei = zoneClock('Asia/Taipei', at);
  assert.deepEqual(brisbane, {
    time: '14:30',
    date: '2026-11-15',
    offsetMinutes: 600,
    night: false,
  });
  assert.equal(taipei.time, '12:30');
  assert.equal(
    zoneClock('Australia/Brisbane', Date.UTC(2026, 10, 15, 14)).date,
    '2026-11-16',
  );
  assert.equal(
    zoneClock('Asia/Taipei', Date.UTC(2026, 10, 15, 13)).night,
    true,
  );
  assert.equal(zoneClock('Not/AZone'), null);
  assert.equal(
    offsetDifferenceText(brisbane.offsetMinutes, taipei.offsetMinutes),
    '+2 h',
  );
  assert.equal(offsetDifferenceText(330, 480), '−2.5 h');
  assert.equal(offsetDifferenceText(480, 480), '±0 h');
});
