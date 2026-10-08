import { Router, type NextFunction, type Request, type Response } from 'express';
import { randomInt } from 'node:crypto';
import { jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';
import { getSessionSecret } from '../services/security-config.js';
import { resolveCompetitionFeature } from '../services/competition-feature-gate.js';
import { resolveCompetitionPupilIdentity } from '../services/competition-pupil-identity.js';
import { calculateCompetitionAnswerPoints, parseCompetitionScoringPolicy } from '../services/competition-scoring.js';

const router = Router();
const prisma = new PrismaClient();

interface CompetitionRequest extends Request {
  competitionUser?: { id: string; role: string; schoolId: string | null };
}

async function requireSession(req: CompetitionRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
    if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (typeof payload.userId !== 'string' || typeof payload.role !== 'string') return res.status(401).json({ error: 'AUTH_INVALID' });
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, role: true, schoolId: true } });
    if (!user || user.role !== payload.role) return res.status(401).json({ error: 'AUTH_INVALID' });
    req.competitionUser = user;
    next();
  } catch {
    return res.status(401).json({ error: 'AUTH_INVALID' });
  }
}

async function requirePlatformAdmin(req: CompetitionRequest, res: Response, next: NextFunction) {
  if (req.competitionUser?.role !== 'PLATFORM_ADMIN') return res.status(403).json({ error: 'PLATFORM_ADMIN_REQUIRED' });
  next();
}

async function requireSchoolStaff(req: CompetitionRequest, res: Response, next: NextFunction) {
  if (!req.competitionUser?.schoolId || !['SCHOOL_ADMIN', 'TEACHER'].includes(req.competitionUser.role)) {
    return res.status(403).json({ error: 'SCHOOL_STAFF_REQUIRED' });
  }
  next();
}

function isPrismaUniqueError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function secureShuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

class AttemptLimitError extends Error {}

router.get('/admin/categories', requireSession, requirePlatformAdmin, async (_req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const categories = await prisma.competitionCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, take: 250 });
  res.json({ categories });
});

router.post('/admin/categories', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const { code, name, description, subjectId, countryCode } = req.body ?? {};
  if (typeof code !== 'string' || !/^[A-Z0-9_-]{2,40}$/.test(code.trim().toUpperCase()) || typeof name !== 'string' || !name.trim() || name.length > 191) return res.status(400).json({ error: 'INVALID_CATEGORY' });
  if (subjectId && typeof subjectId === 'string' && !(await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true } }))) return res.status(400).json({ error: 'SUBJECT_NOT_FOUND' });
  try {
    const category = await prisma.competitionCategory.create({ data: { code: code.trim().toUpperCase(), name: name.trim(), description: typeof description === 'string' ? description.slice(0, 4000) : undefined, subjectId: typeof subjectId === 'string' ? subjectId : undefined, countryCode: typeof countryCode === 'string' ? countryCode.trim().toUpperCase().slice(0, 2) : undefined } });
    await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: 'CATEGORY_CREATED', entityType: 'CompetitionCategory', entityId: category.id } });
    res.status(201).json({ category });
  } catch (error) {
    if (isPrismaUniqueError(error)) return res.status(409).json({ error: 'CATEGORY_CODE_EXISTS' });
    console.error('[competition] category creation failed', error);
    res.status(500).json({ error: 'CATEGORY_CREATE_FAILED' });
  }
});

router.get('/admin/scoring-policies', requireSession, requirePlatformAdmin, async (_req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const policies = await prisma.competitionScoringPolicy.findMany({ orderBy: [{ name: 'asc' }, { version: 'desc' }], take: 100 });
  res.json({ policies });
});

router.post('/admin/scoring-policies', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const { name, policy } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 120 || !policy || typeof policy !== 'object' || Array.isArray(policy) || !Number.isInteger(policy.basePoints) || policy.basePoints < 0 || policy.basePoints > 100000) return res.status(400).json({ error: 'INVALID_SCORING_POLICY' });
  try { parseCompetitionScoringPolicy(JSON.stringify(policy)); } catch { return res.status(400).json({ error: 'INVALID_SCORING_POLICY' }); }
  const version = Number.isInteger(req.body?.version) && req.body.version > 0 ? req.body.version : 1;
  try {
    const scoringPolicy = await prisma.competitionScoringPolicy.create({ data: { name: name.trim(), version, policyJson: JSON.stringify(policy), createdByUserId: req.competitionUser?.id } });
    await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: 'SCORING_POLICY_CREATED', entityType: 'CompetitionScoringPolicy', entityId: scoringPolicy.id } });
    res.status(201).json({ scoringPolicy });
  } catch (error) {
    if (isPrismaUniqueError(error)) return res.status(409).json({ error: 'SCORING_POLICY_VERSION_EXISTS' });
    console.error('[competition] scoring policy creation failed', error);
    res.status(500).json({ error: 'SCORING_POLICY_CREATE_FAILED' });
  }
});

router.post('/admin/challenges', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const { categoryId, questionSetId, scoringPolicyId, title, description, gradeLabel, questionCount, durationSeconds, attemptLimit, difficultyMix } = req.body ?? {};
  if (![categoryId, questionSetId, scoringPolicyId].every((value) => typeof value === 'string') || typeof title !== 'string' || !title.trim() || !Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100 || !Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 7200 || !Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 10) return res.status(400).json({ error: 'INVALID_CHALLENGE' });
  const [category, questionSet, scoringPolicy] = await Promise.all([
    prisma.competitionCategory.findUnique({ where: { id: categoryId }, select: { id: true } }),
    prisma.competitionQuestionSet.findUnique({ where: { id: questionSetId }, select: { id: true, categoryId: true, status: true, _count: { select: { questions: true } } } }),
    prisma.competitionScoringPolicy.findUnique({ where: { id: scoringPolicyId }, select: { id: true } }),
  ]);
  if (!category || !questionSet || !scoringPolicy || questionSet.categoryId !== category.id || questionSet.status === 'ARCHIVED' || questionSet._count.questions < questionCount) return res.status(400).json({ error: 'CHALLENGE_CONFIGURATION_INCOMPLETE' });
  const challenge = await prisma.competitionChallenge.create({ data: { categoryId, questionSetId, scoringPolicyId, title: title.trim(), description: typeof description === 'string' ? description.slice(0, 5000) : undefined, gradeLabel: typeof gradeLabel === 'string' ? gradeLabel.slice(0, 80) : undefined, questionCount, durationSeconds, attemptLimit, difficultyMixJson: difficultyMix && typeof difficultyMix === 'object' && !Array.isArray(difficultyMix) ? JSON.stringify(difficultyMix) : undefined, status: 'DRAFT', createdByUserId: req.competitionUser?.id } });
  await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: 'CHALLENGE_CREATED', entityType: 'CompetitionChallenge', entityId: challenge.id } });
  res.status(201).json({ challenge });
});

router.get('/admin/overview', requireSession, requirePlatformAdmin, async (_req, res) => {
  try {
    const [questionSets, questions, challenges, attempts, tournaments, openFlags] = await Promise.all([
      prisma.competitionQuestionSet.count(),
      prisma.competitionQuestion.count(),
      prisma.competitionChallenge.count(),
      prisma.competitionChallengeAttempt.count(),
      prisma.competitionTournament.count(),
      prisma.competitionSuspiciousActivity.count({ where: { status: 'OPEN' } }),
    ]);
    res.json({ questionSets, questions, challenges, attempts, tournaments, openFlags });
  } catch (error) {
    console.error('[competition] admin overview failed', error);
    res.status(500).json({ error: 'COMPETITION_OVERVIEW_FAILED' });
  }
});

router.get('/admin/question-sets', requireSession, requirePlatformAdmin, async (_req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const sets = await prisma.competitionQuestionSet.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: { category: true, _count: { select: { questions: true } } },
  });
  res.json({ questionSets: sets });
});

router.post('/admin/question-sets', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const { categoryId, name, description, gradeLabel, topic, locale } = req.body ?? {};
  if (typeof categoryId !== 'string' || typeof name !== 'string' || !name.trim() || name.trim().length > 191) {
    return res.status(400).json({ error: 'INVALID_QUESTION_SET' });
  }
  try {
    const category = await prisma.competitionCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) return res.status(400).json({ error: 'INVALID_CATEGORY' });
    const questionSet = await prisma.competitionQuestionSet.create({
      data: {
        categoryId,
        name: name.trim(),
        description: typeof description === 'string' ? description.slice(0, 5000) : undefined,
        gradeLabel: typeof gradeLabel === 'string' ? gradeLabel.slice(0, 80) : undefined,
        topic: typeof topic === 'string' ? topic.slice(0, 160) : undefined,
        locale: typeof locale === 'string' ? locale.slice(0, 16) : 'en',
        createdByUserId: req.competitionUser?.id,
      },
    });
    await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: 'QUESTION_SET_CREATED', entityType: 'CompetitionQuestionSet', entityId: questionSet.id } });
    res.status(201).json({ questionSet });
  } catch (error) {
    console.error('[competition] question set creation failed', error);
    res.status(isPrismaUniqueError(error) ? 409 : 500).json({ error: isPrismaUniqueError(error) ? 'QUESTION_SET_EXISTS' : 'QUESTION_SET_CREATE_FAILED' });
  }
});

router.get('/admin/questions', requireSession, requirePlatformAdmin, async (req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const questionSetId = typeof req.query.questionSetId === 'string' ? req.query.questionSetId : undefined;
  const questions = await prisma.competitionQuestion.findMany({
    where: questionSetId ? { questionSetId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { options: { orderBy: { sortOrder: 'asc' } }, media: true },
  });
  res.json({ questions });
});

router.post('/admin/questions', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const { questionSetId, prompt, type, difficulty, explanation, options, basePoints, timeLimitSeconds } = req.body ?? {};
  const allowedTypes = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'IMAGE', 'ORDERING', 'MATCHING', 'SHORT_ANSWER'];
  const allowedDifficulties = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
  if (typeof questionSetId !== 'string' || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000 || !allowedTypes.includes(type) || !allowedDifficulties.includes(difficulty)) {
    return res.status(400).json({ error: 'INVALID_QUESTION' });
  }
  if (!Array.isArray(options) || options.length < 2 || options.length > 12 || options.some((option) => !option || typeof option.content !== 'string' || !option.content.trim() || typeof option.isCorrect !== 'boolean')) {
    return res.status(400).json({ error: 'INVALID_QUESTION_OPTIONS' });
  }
  if (options.filter((option) => option.isCorrect).length !== 1) return res.status(400).json({ error: 'QUESTION_REQUIRES_ONE_CORRECT_OPTION' });
  try {
    const questionSet = await prisma.competitionQuestionSet.findUnique({ where: { id: questionSetId }, select: { id: true, status: true } });
    if (!questionSet || questionSet.status === 'ARCHIVED') return res.status(400).json({ error: 'INVALID_QUESTION_SET' });
    const question = await prisma.competitionQuestion.create({
      data: {
        questionSetId,
        prompt: prompt.trim(),
        type,
        difficulty,
        explanation: typeof explanation === 'string' ? explanation.slice(0, 12000) : undefined,
        basePoints: Number.isInteger(basePoints) && basePoints >= 0 && basePoints <= 100000 ? basePoints : 100,
        timeLimitSeconds: Number.isInteger(timeLimitSeconds) && timeLimitSeconds > 0 && timeLimitSeconds <= 3600 ? timeLimitSeconds : undefined,
        createdByUserId: req.competitionUser?.id,
        options: { create: options.map((option, sortOrder) => ({ content: option.content.trim().slice(0, 4000), isCorrect: option.isCorrect, sortOrder })) },
      },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: 'QUESTION_CREATED', entityType: 'CompetitionQuestion', entityId: question.id } });
    res.status(201).json({ question });
  } catch (error) {
    console.error('[competition] question creation failed', error);
    res.status(500).json({ error: 'QUESTION_CREATE_FAILED' });
  }
});

router.post('/admin/questions/:id/review', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.questionBank.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const action = req.body?.action;
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 4000) : null;
  if (!['APPROVE', 'REJECT', 'REQUEST_CHANGES'].includes(action)) return res.status(400).json({ error: 'INVALID_REVIEW_ACTION' });
  const status = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'DRAFT';
  try {
    const question = await prisma.competitionQuestion.update({
      where: { id: req.params.id },
      data: { status, reviewedByUserId: req.competitionUser?.id, reviewedAt: new Date(), reviewNotes: notes },
      select: { id: true, questionSetId: true, status: true, reviewedAt: true },
    });
    await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: `QUESTION_${action}`, entityType: 'CompetitionQuestion', entityId: question.id, reason: notes } });
    res.json({ question });
  } catch (error) {
    console.error('[competition] question review failed', error);
    res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
  }
});

router.get('/admin/challenges', requireSession, requirePlatformAdmin, async (_req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const challenges = await prisma.competitionChallenge.findMany({ orderBy: { updatedAt: 'desc' }, take: 100, include: { category: true, _count: { select: { attempts: true } } } });
  res.json({ challenges });
});

router.patch('/admin/challenges/:id/status', requireSession, requirePlatformAdmin, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const status = req.body?.status;
  if (!['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'].includes(status)) return res.status(400).json({ error: 'INVALID_CHALLENGE_STATUS' });
  if (status === 'ACTIVE') {
    const challenge = await prisma.competitionChallenge.findUnique({ where: { id: req.params.id }, include: { questionSet: { include: { questions: { where: { status: 'APPROVED' }, select: { id: true } } } } } });
    if (!challenge || challenge.questionSet.questions.length < challenge.questionCount) return res.status(409).json({ error: 'APPROVED_QUESTION_COUNT_INSUFFICIENT' });
  }
  try {
    const challenge = await prisma.competitionChallenge.update({ where: { id: req.params.id }, data: { status } });
    await prisma.competitionAuditLog.create({ data: { actorUserId: req.competitionUser?.id, action: 'CHALLENGE_STATUS_CHANGED', entityType: 'CompetitionChallenge', entityId: challenge.id, afterJson: JSON.stringify({ status }) } });
    res.json({ challenge });
  } catch (error) {
    console.error('[competition] challenge status update failed', error);
    res.status(404).json({ error: 'CHALLENGE_NOT_FOUND' });
  }
});

router.get('/admin/tournaments', requireSession, requirePlatformAdmin, async (_req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.schoolTournament.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const tournaments = await prisma.competitionTournament.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { category: true, _count: { select: { schools: true, participants: true } } } });
  res.json({ tournaments });
});

router.get('/admin/sponsors', requireSession, requirePlatformAdmin, async (_req, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.sponsors.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const sponsors = await prisma.competitionSponsor.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { advertiser: { select: { companyName: true, website: true, verificationStatus: true } }, _count: { select: { tournaments: true, prizes: true } } } });
  res.json({ sponsors });
});

router.get('/school/overview', requireSession, requireSchoolStaff, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const schoolId = req.competitionUser!.schoolId!;
  if (req.competitionUser!.role === 'TEACHER') {
    const assignments = await prisma.teacherClass.findMany({ where: { schoolId, teacherId: req.competitionUser!.id }, select: { classId: true } });
    const classIds = assignments.map((item) => item.classId);
    const [attempts, challenges] = await Promise.all([
      prisma.competitionChallengeAttempt.count({ where: { schoolId, classId: { in: classIds } } }),
      prisma.competitionChallenge.count({ where: { schoolId, OR: [{ classId: { in: classIds } }, { classId: null }] } }),
    ]);
    return res.json({ attempts, challenges, assignedClasses: classIds.length });
  }
  const [attempts, challenges, tournaments, participants] = await Promise.all([
    prisma.competitionChallengeAttempt.count({ where: { schoolId } }),
    prisma.competitionChallenge.count({ where: { OR: [{ schoolId }, { schoolId: null }] } }),
    prisma.competitionTournamentSchool.count({ where: { schoolId } }),
    prisma.competitionTournamentParticipant.count({ where: { schoolId } }),
  ]);
  res.json({ attempts, challenges, tournaments, participants });
});

router.get('/school/student-links', requireSession, async (req: CompetitionRequest, res) => {
  if (req.competitionUser?.role !== 'SCHOOL_ADMIN' || !req.competitionUser.schoolId) return res.status(403).json({ error: 'SCHOOL_ADMIN_REQUIRED' });
  if (!(await resolveCompetitionFeature(prisma, 'competition.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const schoolId = req.competitionUser.schoolId;
  const [pupils, studentUsers, links] = await Promise.all([
    prisma.pupil.findMany({ where: { schoolId, isActive: true, OR: [{ status: null }, { status: { not: 'INACTIVE' } }] }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true, class: { select: { name: true } }, competitionAccount: { select: { id: true, userId: true, status: true } } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: 500 }),
    prisma.user.findMany({ where: { schoolId, role: 'STUDENT', competitionAccount: null }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 }),
    prisma.competitionPupilAccount.findMany({
      where: { schoolId },
      select: {
        id: true,
        pupilId: true,
        userId: true,
        status: true,
        linkedAt: true,
        pupil: { select: { firstName: true, lastName: true, admissionNo: true, class: { select: { name: true } } } },
        user: { select: { name: true } },
      },
      orderBy: { linkedAt: 'desc' },
      take: 500,
    }),
  ]);
  res.json({ pupils, studentUsers, links });
});

router.post('/school/student-links', requireSession, async (req: CompetitionRequest, res) => {
  if (req.competitionUser?.role !== 'SCHOOL_ADMIN' || !req.competitionUser.schoolId) return res.status(403).json({ error: 'SCHOOL_ADMIN_REQUIRED' });
  if (!(await resolveCompetitionFeature(prisma, 'competition.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const { pupilId, userId } = req.body ?? {};
  if (typeof pupilId !== 'string' || typeof userId !== 'string') return res.status(400).json({ error: 'PUPIL_AND_USER_REQUIRED' });
  const schoolId = req.competitionUser.schoolId;
  try {
    const link = await prisma.$transaction(async (transaction) => {
      const [pupil, user] = await Promise.all([
        transaction.pupil.findFirst({ where: { id: pupilId, schoolId, isActive: true, OR: [{ status: null }, { status: { not: 'INACTIVE' } }] }, select: { id: true } }),
        transaction.user.findFirst({ where: { id: userId, schoolId, role: 'STUDENT' }, select: { id: true } }),
      ]);
      if (!pupil || !user) throw new Error('PUPIL_OR_STUDENT_USER_NOT_ELIGIBLE');
      return transaction.competitionPupilAccount.create({ data: { schoolId, pupilId, userId, linkedByUserId: req.competitionUser!.id } });
    });
    await prisma.competitionAuditLog.create({ data: { schoolId, actorUserId: req.competitionUser.id, action: 'STUDENT_PUPIL_ACCOUNT_LINKED', entityType: 'CompetitionPupilAccount', entityId: link.id, reason: 'School administrator linked an existing student account to an existing active pupil.' } });
    res.status(201).json({ link: { id: link.id, pupilId: link.pupilId, userId: link.userId, status: link.status } });
  } catch (error) {
    if (isPrismaUniqueError(error)) return res.status(409).json({ error: 'PUPIL_OR_USER_ALREADY_LINKED' });
    if (error instanceof Error && error.message === 'PUPIL_OR_STUDENT_USER_NOT_ELIGIBLE') return res.status(400).json({ error: error.message });
    console.error('[competition] pupil account linking failed', error);
    res.status(500).json({ error: 'STUDENT_ACCOUNT_LINK_FAILED' });
  }
});

router.delete('/school/student-links/:linkId', requireSession, async (req: CompetitionRequest, res) => {
  if (req.competitionUser?.role !== 'SCHOOL_ADMIN' || !req.competitionUser.schoolId) return res.status(403).json({ error: 'SCHOOL_ADMIN_REQUIRED' });
  if (!(await resolveCompetitionFeature(prisma, 'competition.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const link = await prisma.competitionPupilAccount.findFirst({ where: { id: req.params.linkId, schoolId: req.competitionUser.schoolId, status: 'ACTIVE' }, select: { id: true, pupilId: true, userId: true } });
  if (!link) return res.status(404).json({ error: 'ACTIVE_LINK_NOT_FOUND' });
  await prisma.competitionPupilAccount.update({ where: { id: link.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
  await prisma.competitionAuditLog.create({ data: { schoolId: req.competitionUser.schoolId, actorUserId: req.competitionUser.id, action: 'STUDENT_PUPIL_ACCOUNT_LINK_REVOKED', entityType: 'CompetitionPupilAccount', entityId: link.id, reason: 'School administrator revoked the student-to-pupil account link.' } });
  res.json({ success: true });
});

router.get('/student/challenges', requireSession, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const identity = await resolveCompetitionPupilIdentity(prisma, req.competitionUser!.id);
  if (!identity) return res.status(403).json({ error: 'STUDENT_IDENTITY_NOT_LINKED' });
  const now = new Date();
  const challenges = await prisma.competitionChallenge.findMany({
    where: {
      status: 'ACTIVE',
      AND: [{ OR: [{ schoolId: null }, { schoolId: identity.schoolId }] }, { OR: [{ classId: null }, { classId: identity.classId }] }, { OR: [{ opensAt: null }, { opensAt: { lte: now } }] }, { OR: [{ closesAt: null }, { closesAt: { gte: now } }] }],
    },
    select: { id: true, title: true, description: true, gradeLabel: true, questionCount: true, durationSeconds: true, closesAt: true },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  const attempts = await prisma.competitionChallengeAttempt.findMany({ where: { pupilId: identity.pupilId, challengeId: { in: challenges.map((item) => item.id) } }, select: { id: true, challengeId: true, status: true, score: true, submittedAt: true } });
  res.json({ identity: { classId: identity.classId }, challenges, attempts });
});

router.post('/student/challenges/:challengeId/attempts', requireSession, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const identity = await resolveCompetitionPupilIdentity(prisma, req.competitionUser!.id);
  if (!identity) return res.status(403).json({ error: 'STUDENT_IDENTITY_NOT_LINKED' });
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey : '';
  if (!idempotencyKey || idempotencyKey.length > 191) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  const now = new Date();
  const challengeQuestionInclude = {
    scoringPolicy: true,
    questionSet: {
      include: {
        questions: {
          where: { status: 'APPROVED' as const },
          select: {
            id: true,
            version: true,
            basePoints: true,
            options: {
              select: { id: true, content: true },
              orderBy: { sortOrder: 'asc' as const },
            },
          },
        },
      },
    },
  };
  const challenge = await prisma.competitionChallenge.findFirst({
    where: { id: req.params.challengeId, status: 'ACTIVE', AND: [{ OR: [{ schoolId: null }, { schoolId: identity.schoolId }] }, { OR: [{ classId: null }, { classId: identity.classId }] }, { OR: [{ opensAt: null }, { opensAt: { lte: now } }] }, { OR: [{ closesAt: null }, { closesAt: { gte: now } }] }] },
    include: challengeQuestionInclude,
  });
  if (!challenge || challenge.questionSet.questions.length < challenge.questionCount) return res.status(404).json({ error: 'CHALLENGE_UNAVAILABLE' });
  const attemptQuestionInclude = {
    questions: {
      orderBy: { position: 'asc' as const },
      include: {
        question: {
          select: {
            id: true,
            prompt: true,
            type: true,
            options: { select: { id: true, content: true }, orderBy: { sortOrder: 'asc' as const } },
          },
        },
      },
    },
  };
  const existing = await prisma.competitionChallengeAttempt.findUnique({ where: { idempotencyKey }, include: attemptQuestionInclude });
  if (existing) {
    if (existing.pupilId !== identity.pupilId || existing.challengeId !== challenge.id) return res.status(409).json({ error: 'IDEMPOTENCY_KEY_CONFLICT' });
    return res.json({ attempt: presentAttempt(existing) });
  }
  const selected = secureShuffle(challenge.questionSet.questions).slice(0, challenge.questionCount);
  const deadlineAt = new Date(now.getTime() + challenge.durationSeconds * 1000);
  try {
    const attempt = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM Pupil WHERE id = ${identity.pupilId} FOR UPDATE`;
      const usedAttempts = await transaction.competitionChallengeAttempt.count({ where: { pupilId: identity.pupilId, challengeId: challenge.id, status: { notIn: ['INVALIDATED', 'ABANDONED'] } } });
      if (usedAttempts >= challenge.attemptLimit) throw new AttemptLimitError();
      const lastAttempt = await transaction.competitionChallengeAttempt.findFirst({ where: { pupilId: identity.pupilId, challengeId: challenge.id }, orderBy: { attemptNumber: 'desc' }, select: { attemptNumber: true } });
      return transaction.competitionChallengeAttempt.create({
        data: {
          schoolId: identity.schoolId,
          pupilId: identity.pupilId,
          classId: identity.classId,
          challengeId: challenge.id,
          academicYearId: challenge.academicYearId,
          termId: challenge.termId,
          scoringPolicyId: challenge.scoringPolicyId,
          attemptNumber: (lastAttempt?.attemptNumber ?? 0) + 1,
          status: 'STARTED',
          idempotencyKey,
          startedAt: now,
          deadlineAt,
          questionCount: selected.length,
          scoringPolicyVersion: challenge.scoringPolicy.version,
          scoringSnapshotJson: challenge.scoringPolicy.policyJson,
          questions: { create: selected.map((question, position) => ({ questionId: question.id, position, questionVersion: question.version, optionOrderJson: JSON.stringify(secureShuffle(question.options).map((option) => option.id)) })) },
        },
        include: attemptQuestionInclude,
      });
    });
    res.status(201).json({ attempt: presentAttempt(attempt) });
  } catch (error) {
    if (error instanceof AttemptLimitError) return res.status(409).json({ error: 'ATTEMPT_LIMIT_REACHED' });
    if (isPrismaUniqueError(error)) return res.status(409).json({ error: 'ATTEMPT_ALREADY_CREATED' });
    console.error('[competition] attempt creation failed', error);
    res.status(500).json({ error: 'ATTEMPT_CREATE_FAILED' });
  }
});

router.post('/student/attempts/:attemptId/answers/:questionId', requireSession, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const identity = await resolveCompetitionPupilIdentity(prisma, req.competitionUser!.id);
  if (!identity) return res.status(403).json({ error: 'STUDENT_IDENTITY_NOT_LINKED' });
  const selectedOptionId = req.body?.optionId;
  if (typeof selectedOptionId !== 'string') return res.status(400).json({ error: 'OPTION_ID_REQUIRED' });
  const attempt = await prisma.competitionChallengeAttempt.findFirst({ where: { id: req.params.attemptId, pupilId: identity.pupilId, schoolId: identity.schoolId }, select: { id: true, status: true, startedAt: true, deadlineAt: true, scoringSnapshotJson: true, questions: { where: { questionId: req.params.questionId }, select: { id: true, questionId: true, question: { select: { difficulty: true, timeLimitSeconds: true } } } } } });
  if (!attempt || attempt.questions.length !== 1) return res.status(404).json({ error: 'ATTEMPT_QUESTION_NOT_FOUND' });
  if (attempt.status !== 'STARTED' || !attempt.deadlineAt || attempt.deadlineAt < new Date()) return res.status(409).json({ error: 'ATTEMPT_NOT_ACTIVE' });
  const option = await prisma.competitionQuestionOption.findFirst({ where: { id: selectedOptionId, questionId: req.params.questionId }, select: { id: true, isCorrect: true } });
  if (!option) return res.status(400).json({ error: 'OPTION_NOT_VALID' });
  const attemptQuestion = attempt.questions[0];
  if (!attemptQuestion) return res.status(404).json({ error: 'ATTEMPT_QUESTION_NOT_FOUND' });
  const elapsedMs = Math.max(0, Date.now() - attempt.startedAt!.getTime());
  let awardedPoints: number;
  try {
    awardedPoints = calculateCompetitionAnswerPoints({ isCorrect: option.isCorrect, difficulty: attemptQuestion.question.difficulty, elapsedMs, timeLimitSeconds: attemptQuestion.question.timeLimitSeconds, policy: parseCompetitionScoringPolicy(attempt.scoringSnapshotJson) });
  } catch (scoringError) {
    console.error('[competition] scoring policy snapshot invalid', scoringError);
    return res.status(500).json({ error: 'SCORING_POLICY_INVALID' });
  }
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM CompetitionChallengeAttempt WHERE id = ${attempt.id} FOR UPDATE`;
      const current = await transaction.competitionChallengeAttempt.findFirst({ where: { id: attempt.id, pupilId: identity.pupilId, schoolId: identity.schoolId }, select: { status: true, deadlineAt: true } });
      if (!current || current.status !== 'STARTED' || !current.deadlineAt || current.deadlineAt < new Date()) throw new Error('ATTEMPT_NOT_ACTIVE');
      await transaction.competitionAnswerSubmission.create({ data: { attemptId: attempt.id, questionId: req.params.questionId, responseJson: JSON.stringify({ optionId: option.id }), isCorrect: option.isCorrect, awardedPoints, elapsedMs } });
      await transaction.competitionChallengeAttempt.update({ where: { id: attempt.id }, data: { score: { increment: awardedPoints }, correctCount: { increment: option.isCorrect ? 1 : 0 } } });
    });
    res.json({ accepted: true });
  } catch (error) {
    if (isPrismaUniqueError(error)) return res.status(409).json({ error: 'QUESTION_ALREADY_ANSWERED' });
    if (error instanceof Error && error.message === 'ATTEMPT_NOT_ACTIVE') return res.status(409).json({ error: 'ATTEMPT_NOT_ACTIVE' });
    console.error('[competition] answer submission failed', error);
    res.status(500).json({ error: 'ANSWER_SUBMISSION_FAILED' });
  }
});

router.post('/student/attempts/:attemptId/submit', requireSession, async (req: CompetitionRequest, res) => {
  if (!(await resolveCompetitionFeature(prisma, 'competition.dailyChallenge.enabled'))) return res.status(404).json({ error: 'FEATURE_DISABLED' });
  const identity = await resolveCompetitionPupilIdentity(prisma, req.competitionUser!.id);
  if (!identity) return res.status(403).json({ error: 'STUDENT_IDENTITY_NOT_LINKED' });
  const attempt = await prisma.competitionChallengeAttempt.findFirst({ where: { id: req.params.attemptId, pupilId: identity.pupilId, schoolId: identity.schoolId }, select: { id: true } });
  if (!attempt) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
  const now = new Date();
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM CompetitionChallengeAttempt WHERE id = ${attempt.id} FOR UPDATE`;
    const current = await transaction.competitionChallengeAttempt.findFirst({ where: { id: attempt.id, pupilId: identity.pupilId, schoolId: identity.schoolId }, include: { answers: { select: { isCorrect: true } } } });
    if (!current) throw new Error('ATTEMPT_NOT_FOUND');
    if (current.status === 'SUBMITTED' || current.status === 'EXPIRED') return current;
    if (current.status !== 'STARTED') throw new Error('ATTEMPT_NOT_ACTIVE');
    const finalStatus = current.deadlineAt && current.deadlineAt < now ? 'EXPIRED' : 'SUBMITTED';
    const count = current.answers.length;
    const accurate = current.answers.filter((answer) => answer.isCorrect).length;
    return transaction.competitionChallengeAttempt.update({ where: { id: current.id }, data: { status: finalStatus, submittedAt: now, elapsedMs: Math.max(0, now.getTime() - (current.startedAt?.getTime() ?? now.getTime())), accuracyPercent: count ? (accurate / count) * 100 : 0 } });
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'ATTEMPT_NOT_FOUND') return null;
    throw error;
  });
  if (!updated) return res.status(404).json({ error: 'ATTEMPT_NOT_FOUND' });
  if (updated.status !== 'SUBMITTED' && updated.status !== 'EXPIRED') return res.status(409).json({ error: 'ATTEMPT_NOT_ACTIVE' });
  res.json({ result: { status: updated.status, score: updated.score, correctCount: updated.correctCount, questionCount: updated.questionCount, accuracyPercent: updated.accuracyPercent, elapsedMs: updated.elapsedMs } });
});

router.get('/student/me', requireSession, async (req: CompetitionRequest, res) => {
  if (req.competitionUser?.role !== 'STUDENT') return res.status(403).json({ error: 'STUDENT_REQUIRED' });
  const identity = await resolveCompetitionPupilIdentity(prisma, req.competitionUser.id);
  if (!identity) return res.status(403).json({ error: 'STUDENT_IDENTITY_NOT_LINKED' });
  const [pupil, xp] = await Promise.all([
    prisma.pupil.findUnique({ where: { id: identity.pupilId }, select: { firstName: true, class: { select: { name: true } } } }),
    prisma.competitionXpTransaction.aggregate({ where: { pupilId: identity.pupilId }, _sum: { amount: true } }),
  ]);
  res.json({ student: { firstName: pupil?.firstName, className: pupil?.class?.name, xp: xp._sum.amount ?? 0 } });
});

function presentAttempt(attempt: any) {
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    questions: attempt.questions.map((entry: any) => ({
      id: entry.question.id,
      type: entry.question.type,
      prompt: entry.question.prompt,
      options: JSON.parse(entry.optionOrderJson).map((optionId: string) => entry.question.options.find((option: any) => option.id === optionId)).filter(Boolean),
    })),
  };
}

export default router;
