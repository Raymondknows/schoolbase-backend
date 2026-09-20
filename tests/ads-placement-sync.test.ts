import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlacementIds } from '../src/routes/ads-utils.js';

test('normalizes placement assignments by keeping valid ids unique and in order', () => {
  assert.deepEqual(normalizePlacementIds(['a', 'b', 'a', '', null, 'c', undefined, 'b']), ['a', 'b', 'c']);
  assert.deepEqual(normalizePlacementIds([]), []);
});
