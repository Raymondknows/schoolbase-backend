import type { PrismaClient } from '@prisma/client';
import { isStudentCurrentlyEnrolled } from './student-lifecycle.js';

export type CompetitionPupilIdentity = {
  userId: string;
  pupilId: string;
  schoolId: string;
  classId: string | null;
};

export function isEligibleCompetitionPupilLink(input: {
  userRole?: string | null;
  userSchoolId?: string | null;
  pupilSchoolId?: string | null;
  linkSchoolId?: string | null;
  linkStatus?: string | null;
  pupilIsActive?: boolean | null;
  pupilStatus?: string | null;
}): boolean {
  return input.userRole === 'STUDENT' &&
    Boolean(input.userSchoolId) &&
    input.userSchoolId === input.pupilSchoolId &&
    input.userSchoolId === input.linkSchoolId &&
    input.linkStatus === 'ACTIVE' &&
    isStudentCurrentlyEnrolled({ isActive: input.pupilIsActive, status: input.pupilStatus });
}

export async function resolveCompetitionPupilIdentity(
  prisma: PrismaClient,
  authenticatedUserId: string,
): Promise<CompetitionPupilIdentity | null> {
  const user = await prisma.user.findUnique({
    where: { id: authenticatedUserId },
    select: { id: true, role: true, schoolId: true },
  });

  if (!user || user.role !== 'STUDENT' || !user.schoolId) return null;

  const account = await prisma.competitionPupilAccount.findUnique({
    where: { userId: user.id },
    select: {
      schoolId: true,
      status: true,
      pupil: { select: { id: true, schoolId: true, classId: true, isActive: true, status: true } },
    },
  });

  if (!account || !isEligibleCompetitionPupilLink({
    userRole: user.role,
    userSchoolId: user.schoolId,
    pupilSchoolId: account.pupil.schoolId,
    linkSchoolId: account.schoolId,
    linkStatus: account.status,
    pupilIsActive: account.pupil.isActive,
    pupilStatus: account.pupil.status,
  })) {
    return null;
  }

  return {
    userId: user.id,
    pupilId: account.pupil.id,
    schoolId: user.schoolId,
    classId: account.pupil.classId,
  };
}