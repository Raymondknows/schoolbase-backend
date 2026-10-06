import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildIdCardPreflightWarnings, resolveIdCardPayerEmail, verifyPaystackSignature } from '../src/services/id-card-payment.ts';

describe('ID-card Paystack payer email', () => {
  it('uses a valid administrator email first', () => {
    assert.equal(resolveIdCardPayerEmail(' admin@example.org ', 'accounts@school.org'), 'admin@example.org');
  });

  it('falls back to the school contact email when the administrator email is invalid', () => {
    assert.equal(resolveIdCardPayerEmail('Mrs. Adebayo', ' accounts@greenfield.edu.ng '), 'accounts@greenfield.edu.ng');
    assert.equal(resolveIdCardPayerEmail('demo@schoolbase', 'accounts@greenfield.edu.ng'), 'accounts@greenfield.edu.ng');
  });

  it('returns null when neither email is valid', () => {
    assert.equal(resolveIdCardPayerEmail('invalid-email', 'also-invalid'), null);
    assert.equal(resolveIdCardPayerEmail(null, '   '), null);
  });

  it('validates Paystack HMAC signatures over the exact raw request body', () => {
    const secret = 'test-paystack-secret';
    const body = Buffer.from('{"event":"charge.success","data":{"reference":"IDCARD-test"}}');
    const signature = createHmac('sha512', secret).update(body).digest('hex');
    assert.equal(verifyPaystackSignature(body, signature, secret), true);
    assert.equal(verifyPaystackSignature(Buffer.from(`${body.toString()} `), signature, secret), false);
    assert.equal(verifyPaystackSignature(body, undefined, secret), false);
  });

  it('reports missing photo, admission number and class fields without rejecting the student', () => {
    const warnings = buildIdCardPreflightWarnings([
      { id: 'pupil-1', firstName: 'Ada', lastName: 'Okafor', photoUrl: null, admissionNo: null, class: null },
      { id: 'pupil-2', firstName: 'Timi', lastName: 'Bello', photoUrl: '/uploads/photos/timi.jpg', admissionNo: 'GFA-2', class: { name: 'JSS 1' } },
    ]);
    assert.equal(warnings.length, 3);
    assert.deepEqual(warnings.map((warning) => warning.field), ['photo', 'admissionNo', 'class']);
    assert.equal(warnings[0].pupilId, 'pupil-1');
  });
});