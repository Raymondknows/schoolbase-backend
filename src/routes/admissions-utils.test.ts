import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAdmissionStatus, getAdmissionStatusLabel } from './admissions-utils.js';

test('normalizes known statuses to the allowed MVP values', () => {
  assert.equal(normalizeAdmissionStatus('submitted'), 'SUBMITTED');
  assert.equal(normalizeAdmissionStatus('under review'), 'UNDER_REVIEW');
  assert.equal(normalizeAdmissionStatus('Approved'), 'APPROVED');
  assert.equal(normalizeAdmissionStatus('rejected'), 'REJECTED');
});

test('falls back to submitted for unknown values', () => {
  assert.equal(normalizeAdmissionStatus('random-status'), 'SUBMITTED');
  assert.equal(normalizeAdmissionStatus(undefined), 'SUBMITTED');
});

test('returns a readable label for each supported status', () => {
  assert.equal(getAdmissionStatusLabel('SUBMITTED'), 'Submitted');
  assert.equal(getAdmissionStatusLabel('UNDER_REVIEW'), 'Under Review');
  assert.equal(getAdmissionStatusLabel('APPROVED'), 'Approved');
  assert.equal(getAdmissionStatusLabel('REJECTED'), 'Rejected');
});
