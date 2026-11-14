// This build falls back to the public Overpass only when none is configured.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OVERPASS_UPSTREAMS,
  applyBuildDefaults,
} from './buildDefaults.js';

test('an unset or empty OVERPASS_UPSTREAMS takes the public instance', () => {
  assert.equal(
    applyBuildDefaults({}).OVERPASS_UPSTREAMS,
    DEFAULT_OVERPASS_UPSTREAMS,
  );
  // `.env.example` ships the key empty; a copied file must still work.
  assert.equal(
    applyBuildDefaults({ OVERPASS_UPSTREAMS: ' ' }).OVERPASS_UPSTREAMS,
    DEFAULT_OVERPASS_UPSTREAMS,
  );
});

test("the operator's own value, including an opt-out, is kept", () => {
  for (const value of ['off', 'https://overpass.example.org/api/interpreter'])
    assert.equal(
      applyBuildDefaults({ OVERPASS_UPSTREAMS: value }).OVERPASS_UPSTREAMS,
      value,
    );
});
