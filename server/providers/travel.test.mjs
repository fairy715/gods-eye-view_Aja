// The travel link resolver follows a Google Maps short link between Google
// hosts only, and never anything else.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapLink } from './travel.js';

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, 'manual', 'redirects are followed by hand');
    const route = routes[String(url)];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return new Response(route.body ?? null, {
      status: route.status,
      headers: route.location ? { location: route.location } : {},
    });
  };
  return { fetchImpl, calls };
}

test('a short link is followed to the map URL that carries the position', async () => {
  const final =
    'https://www.google.com/maps/place/X/@-27.47,153.02,17z/data=!3d-27.4698!4d153.0251';
  const { fetchImpl, calls } = fakeFetch({
    'https://maps.app.goo.gl/AbC': { status: 302, location: final },
    [final]: { status: 200, body: '<html></html>' },
  });
  assert.deepEqual(
    await resolveMapLink('https://maps.app.goo.gl/AbC', { fetchImpl }),
    ['https://maps.app.goo.gl/AbC', final],
  );
  assert.equal(calls.length, 2);
});

test('a landing page that names its map centre adds it as a geo: URI', async () => {
  const final = 'https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x0';
  const { fetchImpl } = fakeFetch({
    'https://goo.gl/maps/xyz': { status: 301, location: final },
    [final]: {
      status: 200,
      body: '<meta content="https://maps.google.com/maps/api/staticmap?center=-27.4698%2C153.0251&zoom=17">',
    },
  });
  const urls = await resolveMapLink('https://goo.gl/maps/xyz', { fetchImpl });
  assert.equal(urls.at(-1), 'geo:-27.4698,153.0251');
});

test('a redirect off Google is not followed', async () => {
  const { fetchImpl, calls } = fakeFetch({
    'https://maps.app.goo.gl/AbC': {
      status: 302,
      location: 'https://169.254.169.254/latest/meta-data/',
    },
  });
  assert.deepEqual(
    await resolveMapLink('https://maps.app.goo.gl/AbC', { fetchImpl }),
    ['https://maps.app.goo.gl/AbC'],
  );
  assert.equal(calls.length, 1);
});

test('only Google Maps short links are accepted', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  for (const link of [
    'https://example.com/maps',
    'http://maps.app.goo.gl/AbC',
    'https://maps.app.goo.gl.evil.example/AbC',
    'https://user@maps.app.goo.gl/AbC',
    'https://maps.app.goo.gl:8443/AbC',
    'https://goo.gl/other',
    'http://localhost:4173/api/keys',
    'not a url',
    '',
  ])
    await assert.rejects(
      resolveMapLink(link, { fetchImpl }),
      (error) => error.status === 400,
      link,
    );
  assert.equal(calls.length, 0, 'nothing was fetched');
});
