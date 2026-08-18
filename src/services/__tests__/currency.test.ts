import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultCurrency, normalizeCurrency, resolveSupportedCurrency } from '../currency.js';

test('normalizeCurrency rejects unsupported currencies', () => {
  assert.equal(normalizeCurrency('KES'), undefined);
  assert.equal(normalizeCurrency('UGX'), undefined);
  assert.equal(normalizeCurrency('NGN'), 'NGN');
  assert.equal(normalizeCurrency('GHS'), 'GHS');
});

test('resolveSupportedCurrency falls back to the supported default currency', () => {
  assert.equal(resolveSupportedCurrency('KES'), getDefaultCurrency());
  assert.equal(resolveSupportedCurrency('UGX', 'GHS'), 'GHS');
  assert.equal(resolveSupportedCurrency('NGN'), 'NGN');
});

test('resolveSupportedCurrency uses the third fallback when the first two values are unsupported', () => {
  assert.equal(resolveSupportedCurrency('KES', 'UGX', 'GHS'), 'GHS');
  assert.equal(resolveSupportedCurrency('', 'USD', 'NGN'), 'NGN');
});
