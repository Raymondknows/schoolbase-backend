import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultWhatsAppPolicy, evaluateSchoolWhatsAppSend } from '../whatsapp-policy.js';

test('default policy allows large school broadcasts without manual approval', () => {
  const policy = getDefaultWhatsAppPolicy('school-a');

  assert.equal(policy.schoolId, 'school-a');
  assert.equal(policy.enabled, true);
  assert.equal(policy.quietHoursStart, '21:00');
  assert.equal(policy.quietHoursEnd, '07:00');
  assert.equal(policy.requireApprovalForBulk, false);
  assert.ok(policy.batchSize >= 200);
});

test('large bulk sends are allowed by default when outside quiet hours', () => {
  const policy = getDefaultWhatsAppPolicy('school-a');
  const result = evaluateSchoolWhatsAppSend(policy, {
    recipientCount: 450,
    now: new Date('2026-09-07T10:00:00.000Z'),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, undefined);
});

test('approved bulk sends still remain subject to quiet hours', () => {
  const policy = getDefaultWhatsAppPolicy('school-a');
  const result = evaluateSchoolWhatsAppSend(policy, {
    recipientCount: 60,
    approvedForBulk: true,
    now: new Date('2026-09-07T20:30:00.000Z'),
    timezone: 'Africa/Lagos',
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason ?? '', /quiet/i);
});

test('quiet-hour checks block automated sends during the configured local nighttime window', () => {
  const policy = getDefaultWhatsAppPolicy('school-a');
  const result = evaluateSchoolWhatsAppSend(policy, {
    recipientCount: 1,
    now: new Date('2026-09-07T20:30:00.000Z'),
    timezone: 'Africa/Lagos',
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason ?? '', /quiet/i);
});
