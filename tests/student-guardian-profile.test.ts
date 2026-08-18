import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuardianProfileData } from '../src/services/student-guardian-profile.js';

test('normalizes guardian profile data for updates', () => {
  const payload = normalizeGuardianProfileData({
    guardianFirst: 'Ada',
    guardianLast: 'Lovelace',
    guardianEmail: '',
    guardianPhone: '+2347086468166',
    guardianAltPhone: '',
    guardianOccupation: '',
  });

  assert.equal(payload.firstName, 'Ada');
  assert.equal(payload.lastName, 'Lovelace');
  assert.equal(payload.phone, '+2347086468166');
  assert.equal(payload.altPhone, null);
  assert.equal(payload.email, null);
  assert.equal(payload.occupation, null);
});

test('keeps explicit guardian contact values intact', () => {
  const payload = normalizeGuardianProfileData({
    guardianFirst: 'John',
    guardianLast: 'Doe',
    guardianEmail: 'john@example.com',
    guardianPhone: '07086468166',
    guardianAltPhone: '08012345678',
    guardianOccupation: 'Engineer',
  });

  assert.equal(payload.firstName, 'John');
  assert.equal(payload.lastName, 'Doe');
  assert.equal(payload.phone, '07086468166');
  assert.equal(payload.altPhone, '08012345678');
  assert.equal(payload.email, 'john@example.com');
  assert.equal(payload.occupation, 'Engineer');
});

test('treats blank guardian phone values as absent so existing data is preserved', () => {
  const payload = normalizeGuardianProfileData({
    guardianFirst: 'Jane',
    guardianLast: 'Doe',
    guardianPhone: '',
  });

  assert.equal(payload.phone, null);
  assert.equal(payload.firstName, 'Jane');
});
