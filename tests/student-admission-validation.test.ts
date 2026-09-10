import test from 'node:test';
import assert from 'node:assert/strict';

import { getNextAdmissionNo, normalizeAdmissionNo, validateUniqueAdmissionNo } from '../src/services/student-admission.js';

test('normalizeAdmissionNo strips whitespace and normalizes duplicates safely', () => {
  assert.equal(normalizeAdmissionNo('  ADM-002  '), 'ADM-002');
  assert.equal(normalizeAdmissionNo('   '), null);
  assert.equal(normalizeAdmissionNo(null), null);
});

test('getNextAdmissionNo uses the highest existing sequence instead of row count', () => {
  const nextNo = getNextAdmissionNo({
    schoolId: 'school-1',
    schoolName: 'Greenfield Academy',
    schoolInitials: 'GFA',
    year: 2026,
    existingRecords: [
      { id: 's1', schoolId: 'school-1', admissionNo: 'GFA-2026-0001' },
      { id: 's2', schoolId: 'school-1', admissionNo: 'GFA-2026-0003' },
      { id: 's3', schoolId: 'school-1', admissionNo: 'GFA-2026-0033' },
      { id: 's4', schoolId: 'school-2', admissionNo: 'GFA-2026-0034' },
    ],
  });

  assert.equal(nextNo, 'GFA-2026-0034');
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
