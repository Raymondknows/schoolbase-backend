import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBulkPinNotificationRequest } from '../pin-notification-batch-guards.js';

test('allows a small batch of PIN notifications', () => {
  const result = validateBulkPinNotificationRequest({ pinCount: 5, guardianCount: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
});

test('accepts oversized batches and reports a safe batch size for chunking', () => {
  const result = validateBulkPinNotificationRequest({ pinCount: 25, guardianCount: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.maxPinsPerBatch, 10);
});

test('accepts a batch that needs chunking and preserves the safe batch size', () => {
  const result = validateBulkPinNotificationRequest({ pinCount: 10, guardianCount: 6 });

  assert.equal(result.ok, true);
  assert.equal(result.maxPinsPerBatch, 3);
});
