import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAdmissionNo, validateUniqueAdmissionNo } from '../src/services/student-admission.js';

test('normalizeAdmissionNo strips whitespace and normalizes duplicates safely', () => {
  assert.equal(normalizeAdmissionNo('  ADM-002  '), 'ADM-002');
  assert.equal(normalizeAdmissionNo('   '), null);
  assert.equal(normalizeAdmissionNo(null), null);
});

test('validateUniqueAdmissionNo rejects a duplicate in the same school', () => {
  const result = validateUniqueAdmissionNo({
    schoolId: 'school-1',
    admissionNo: 'ADM-002',
    currentStudentId: 'student-3',
    existingRecords: [
      { id: 'student-1', schoolId: 'school-1', admissionNo: 'ADM-002' },
      { id: 'student-2', schoolId: 'school-1', admissionNo: 'ADM-003' },
    ],
  });

  assert.equal(result.isValid, false);
  assert.match(result.error ?? '', /already exists/i);
});

test('validateUniqueAdmissionNo allows a same student to keep the same number', () => {
  const result = validateUniqueAdmissionNo({
    schoolId: 'school-1',
    admissionNo: 'ADM-002',
    currentStudentId: 'student-1',
    existingRecords: [
      { id: 'student-1', schoolId: 'school-1', admissionNo: 'ADM-002' },
      { id: 'student-2', schoolId: 'school-1', admissionNo: 'ADM-003' },
    ],
  });

  assert.equal(result.isValid, true);
  assert.equal(result.error, undefined);
});
