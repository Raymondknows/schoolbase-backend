import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBulkPinNotificationRequest } from '../pin-notification-batch-guards.js';

test('allows a small batch of PIN notifications', () => {
  const result = validateBulkPinNotificationRequest({ pinCount: 5, guardianCount: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
});

test('accepts oversized batches and reports the school-safe batch size for chunking', () => {
  const result = validateBulkPinNotificationRequest({ pinCount: 25, guardianCount: 2 });

  assert.equal(result.ok, true);
  assert.equal(result.maxPinsPerBatch, 250);
  assert.equal(result.maxTotalNotifications, 250);
});

test('keeps large school batches aligned with the policy default instead of a tiny manual cap', () => {
  const result = validateBulkPinNotificationRequest({ pinCount: 10, guardianCount: 6 });

  assert.equal(result.ok, true);
  assert.equal(result.maxPinsPerBatch, 250);
  assert.equal(result.maxTotalNotifications, 250);
});
