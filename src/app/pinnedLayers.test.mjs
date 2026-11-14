// Pinned layers switch on at startup unless the user switched them off.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { installPinnedLayers } from './pinnedLayers.js';

function fixture(stored = null) {
  const data = new Map(stored ? [['gev.pinnedLayersOff', stored]] : []);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  const calls = [];
  let listener = null;
  const manager = {
    layers: new Map([['venues', {}]]),
    setEnabled: (id, on) => calls.push([id, on]),
    subscribe(callback) {
      listener = callback;
      return () => (listener = null);
    },
  };
  return {
    storage,
    data,
    calls,
    manager,
    emit: (change) => listener?.(change),
  };
}

test('a pinned layer is enabled at startup', () => {
  const { storage, calls, manager } = fixture();
  installPinnedLayers(manager, { storage });
  assert.deepEqual(calls, [['venues', true]]);
});

test("the user's own off switch is remembered, and only the user's", () => {
  const first = fixture();
  installPinnedLayers(first.manager, { storage: first.storage });
  first.emit({ type: 'visibility', layerId: 'venues', enabled: false });
  assert.equal(first.data.size, 0, 'a programmatic change is not a choice');
  first.emit({
    type: 'visibility',
    layerId: 'venues',
    enabled: false,
    origin: 'user',
  });
  const second = fixture(first.data.get('gev.pinnedLayersOff'));
  installPinnedLayers(second.manager, { storage: second.storage });
  assert.deepEqual(second.calls, [], 'stays off on the next launch');
  second.emit({
    type: 'visibility',
    layerId: 'venues',
    enabled: true,
    origin: 'user',
  });
  assert.equal(second.data.get('gev.pinnedLayersOff'), '[]');
});

test('unreadable storage and unknown layers are tolerated', () => {
  const { calls, manager } = fixture();
  const storage = {
    getItem: () => '{not json',
    setItem: () => {
      throw new Error('denied');
    },
  };
  installPinnedLayers(manager, { storage, ids: ['venues', 'missing'] });
  assert.deepEqual(calls, [['venues', true]]);
});
