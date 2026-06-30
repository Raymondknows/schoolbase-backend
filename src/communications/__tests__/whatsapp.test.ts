import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhatsappRecipient, sanitizeSchoolId } from '../whatsapp.js';

test('normalizeWhatsappRecipient converts numbers into the expected recipient format', () => {
  assert.equal(normalizeWhatsappRecipient('+2348123456789'), '2348123456789@c.us');
  assert.equal(normalizeWhatsappRecipient('2348123456789'), '2348123456789@c.us');
});

test('sanitizeSchoolId keeps school names predictable for session storage', () => {
  assert.equal(sanitizeSchoolId('Example School'), 'example-school');
  assert.equal(sanitizeSchoolId('  '), 'default');
});
