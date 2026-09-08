import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppDeliveryHash, buildWhatsAppDeliveryPreview } from '../whatsapp-delivery-store.js';

test('buildWhatsAppDeliveryHash is stable and school-scoped', () => {
  const first = buildWhatsAppDeliveryHash('school-a', '+2348000000001', 'Fee payment reminder: #5000');
  const second = buildWhatsAppDeliveryHash('school-a', '+2348000000001', 'Fee payment reminder: #5000');
  const third = buildWhatsAppDeliveryHash('school-b', '+2348000000001', 'Fee payment reminder: #5000');

  assert.equal(first, second);
  assert.notEqual(first, third);
});

test('buildWhatsAppDeliveryPreview truncates long message bodies safely', () => {
  const preview = buildWhatsAppDeliveryPreview('A very long message body that should be trimmed before storage in the durable WhatsApp delivery table for safe support review.', 80);

  assert.ok(preview.length <= 80);
  assert.ok(preview.endsWith('...'));
});
