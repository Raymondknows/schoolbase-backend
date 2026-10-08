import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  isEligibleCompetitionPupilLink,
  resolveCompetitionPupilIdentity,
} from '../src/services/competition-pupil-identity.js';

const validLink = {
  userRole: 'STUDENT',
  userSchoolId: 'school-1',
  pupilSchoolId: 'school-1',
  linkSchoolId: 'school-1',
  linkStatus: 'ACTIVE',
  pupilIsActive: true,
  pupilStatus: 'ACTIVE',
};

assert.equal(isEligibleCompetitionPupilLink(validLink), true);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, userRole: 'SCHOOL_ADMIN' }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, userSchoolId: 'school-2' }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, pupilSchoolId: 'school-2' }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, linkSchoolId: 'school-2' }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, linkStatus: 'REVOKED' }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, pupilIsActive: false }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, pupilStatus: 'INACTIVE' }), false);
assert.equal(isEligibleCompetitionPupilLink({ ...validLink, userSchoolId: null }), false);

const queries: Array<{ kind: string; args: unknown }> = [];
const prisma = {
  user: {
    findUnique: async (args: unknown) => {
      queries.push({ kind: 'user', args });
      return { id: 'user-1', role: 'STUDENT', schoolId: 'school-1' };
    },
  },
  competitionPupilAccount: {
    findUnique: async (args: unknown) => {
      queries.push({ kind: 'link', args });
      return {
        schoolId: 'school-1',
        status: 'ACTIVE',
        pupil: { id: 'pupil-1', schoolId: 'school-1', classId: 'class-1', isActive: true, status: null },
      };
    },
  },
} as unknown as PrismaClient;

const identity = await resolveCompetitionPupilIdentity(prisma, 'user-1');
assert.deepEqual(identity, {
  userId: 'user-1',
  pupilId: 'pupil-1',
  schoolId: 'school-1',
  classId: 'class-1',
});
assert.deepEqual(queries.map((query) => query.kind), ['user', 'link']);
assert.deepEqual(queries[1].args, {
  where: { userId: 'user-1' },
  select: {
    schoolId: true,
    status: true,
    pupil: { select: { id: true, schoolId: true, classId: true, isActive: true, status: true } },
  },
});

function prismaWithIdentity(user: unknown, account: unknown) {
  return {
    user: { findUnique: async () => user },
    competitionPupilAccount: { findUnique: async () => account },
  } as unknown as PrismaClient;
}

const enrolledPupil = {
  id: 'pupil-1',
  schoolId: 'school-1',
  classId: null,
  isActive: true,
  status: null,
};
const studentUser = { id: 'user-1', role: 'STUDENT', schoolId: 'school-1' };
const activeLink = { schoolId: 'school-1', status: 'ACTIVE', pupil: enrolledPupil };

assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(null, activeLink), 'missing-user'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity({ ...studentUser, role: 'TEACHER' }, activeLink), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity({ ...studentUser, schoolId: null }, activeLink), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(studentUser, null), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(studentUser, { ...activeLink, status: 'REVOKED' }), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(studentUser, { ...activeLink, schoolId: 'school-2' }), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(studentUser, { ...activeLink, pupil: { ...enrolledPupil, schoolId: 'school-2' } }), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(studentUser, { ...activeLink, pupil: { ...enrolledPupil, status: 'INACTIVE' } }), 'user-1'), null);
assert.equal(await resolveCompetitionPupilIdentity(prismaWithIdentity(studentUser, { ...activeLink, pupil: { ...enrolledPupil, isActive: false } }), 'user-1'), null);

console.log('Competition pupil identity tests passed');