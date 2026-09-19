import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSchoolScope } from '../security-context.js';

test('school users are pinned to their authenticated school', () => {
  assert.deepEqual(
    resolveSchoolScope({
      authenticatedSchoolId: 'school-a',
      authenticatedRole: 'SCHOOL_ADMIN',
      requestedSchoolId: 'school-b',
    }),
    {
      schoolId: null,
      rejected: true,
      reason: 'Requested school does not match the authenticated school',
    },
  );
});

test('matching requested school is accepted for school users', () => {
  assert.deepEqual(
    resolveSchoolScope({
      authenticatedSchoolId: 'school-a',
      authenticatedRole: 'TEACHER',
      requestedSchoolId: 'school-a',
    }),
    { schoolId: 'school-a', rejected: false },
  );
});

test('platform admins may target an explicitly requested school', () => {
  assert.deepEqual(
    resolveSchoolScope({
      authenticatedSchoolId: 'platform',
      authenticatedRole: 'PLATFORM_ADMIN',
      requestedSchoolId: 'school-b',
    }),
    { schoolId: 'school-b', rejected: false },
  );
});

test('missing context remains unresolved instead of guessing a tenant', () => {
  assert.deepEqual(resolveSchoolScope({ requestedSchoolId: 'school-a' }), {
    schoolId: null,
    rejected: false,
  });
});
