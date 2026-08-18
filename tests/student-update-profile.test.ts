import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudentUpdateData } from '../src/services/student-update-profile.js';

test('preserves existing student fields when edit payload omits them', () => {
  const merged = buildStudentUpdateData(
    {
      firstName: 'Ada',
      lastName: 'Lovelace',
    },
    {
      firstName: 'Grace',
      middleName: 'Murray',
      lastName: 'Hopper',
      classId: 'class-1',
      status: 'ACTIVE',
      admissionDate: '2024-01-12',
      gender: 'Female',
      dateOfBirth: '2015-12-09',
      studentEmail: 'old@example.com',
      studentPhone: '08011111111',
      address: 'Old address',
      bloodGroup: 'O+',
      genotype: 'AA',
      medicalNotes: 'Needs rest',
      previousSchool: 'Old school',
      previousClass: 'Basic 1',
    },
  );

  assert.equal(merged.firstName, 'Ada');
  assert.equal(merged.middleName, 'Murray');
  assert.equal(merged.lastName, 'Lovelace');
  assert.equal(merged.classId, 'class-1');
  assert.equal(merged.studentEmail, 'old@example.com');
  assert.equal(merged.address, 'Old address');
  assert.equal(merged.previousSchool, 'Old school');
});

test('keeps explicit blank values from wiping existing data', () => {
  const merged = buildStudentUpdateData(
    {
      firstName: '',
      middleName: '',
      lastName: '',
      studentEmail: '',
      studentPhone: '',
      address: '',
      bloodGroup: '',
      genotype: '',
      medicalNotes: '',
      previousSchool: '',
      previousClass: '',
    },
    {
      firstName: 'Grace',
      middleName: 'Murray',
      lastName: 'Hopper',
      studentEmail: 'old@example.com',
      studentPhone: '08011111111',
      address: 'Old address',
      bloodGroup: 'O+',
      genotype: 'AA',
      medicalNotes: 'Needs rest',
      previousSchool: 'Old school',
      previousClass: 'Basic 1',
    },
  );

  assert.equal(merged.firstName, 'Grace');
  assert.equal(merged.middleName, 'Murray');
  assert.equal(merged.lastName, 'Hopper');
  assert.equal(merged.studentEmail, 'old@example.com');
  assert.equal(merged.address, 'Old address');
  assert.equal(merged.previousSchool, 'Old school');
});
