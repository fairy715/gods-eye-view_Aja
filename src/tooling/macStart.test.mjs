// The macOS app's server launcher listens on loopback, on PORT or 4173.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { macLaunchPort } from '../../scripts/mac-start.mjs';

test('the port is PORT when valid, else 4173', () => {
  assert.equal(macLaunchPort('4175'), 4175);
  for (const value of [undefined, '', 'x', '0', '70000', '-1'])
    assert.equal(macLaunchPort(value), 4173, String(value));
});
