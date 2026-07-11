import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import ReportCardService from '../services/report-card.service.js';

const router = Router();
const prisma = new PrismaClient() as PrismaClient & {
  resultPin: any;
  resultPinBatch: any;
};
const reportCardService = new ReportCardService(prisma);

function getPublicGrade(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function buildPublicResultPayloadItem(input: {
  assessmentId: string;
  assessmentName?: string | null;
  termName?: string | null;
  termId?: string | null;
  totalScore?: number | null;
  caScore?: number | null;
  testScore?: number | null;
  examScore?: number | null;
  grade?: string | null;
}) {
  return {
    id: input.assessmentId,
    assessmentId: input.assessmentId,
    term: input.termName ?? 'Unknown term',
    termId: input.termId ?? null,
    subject: input.assessmentName ?? 'Assessment',
    totalScore: input.totalScore ?? null,
    caScore: input.caScore ?? null,
    testScore: input.testScore ?? null,
    examScore: input.examScore ?? null,
    grade: input.grade ?? null,
  };
}

export async function resolveSchoolForPublicResultCheck(prismaClient: PrismaClient, schoolCode: string) {
  const normalizedInput = String(schoolCode ?? '').trim();
  const compactInput = normalizedInput.replace(/\s+/g, ' ').trim();
  const slugCandidates = [compactInput.toLowerCase(), compactInput.toLowerCase().replace(/\s+/g, '-'), compactInput.replace(/\s+/g, '-').toLowerCase()];
  const initialsCandidates = [compactInput.replace(/\s+/g, '').toUpperCase(), compactInput.toUpperCase()];
  const nameCandidates = [compactInput, compactInput.toLowerCase(), compactInput.toUpperCase()];

  const results = await prismaClient.school.findMany({
    where: {
      OR: [
        { slug: { in: slugCandidates } },
        { initials: { in: initialsCandidates } },
        { name: { contains: compactInput } },
        { name: { contains: compactInput.toLowerCase() } },
        { name: { contains: compactInput.toUpperCase() } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      initials: true,
      resultAccessPinEnabled: true,
      resultAccessMode: true,
    },
  });

  if (!results.length) {
    return null;
  }

  const normalizedWanted = compactInput.toLowerCase().replace(/\s+/g, ' ');

  const exactMatch = results.find((school) => {
    if (!school.slug || !compactInput) return false;
    const name = (school.name || '').toLowerCase().replace(/\s+/g, ' ');
    const slug = (school.slug || '').toLowerCase().replace(/\s+/g, '-');
    const initials = (school.initials || '').toUpperCase().replace(/\s+/g, '');
    return slug === normalizedWanted.replace(/\s+/g, '-') || name === normalizedWanted || initials === compactInput.replace(/\s+/g, '').toUpperCase();
  });

  return exactMatch ?? results[0] ?? null;
}

router.get('/videos', async (_req: Request, res: Response) => {
  try {
    const videos = await prisma.videoTutorial.findMany({
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      videos: videos.map((video) => ({
        id: video.id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        category: video.category,
        featured: video.featured,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching public videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

router.get('/videos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const video = await prisma.videoTutorial.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({
      video: {
        id: video.id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        category: video.category,
        featured: video.featured,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching public video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

router.post('/results/check', async (req: Request, res: Response) => {
  try {
    const schoolCode = String(req.body?.schoolCode ?? '').trim().toLowerCase();
    const admissionNo = String(req.body?.admissionNo ?? '').trim();
    const pin = String(req.body?.pin ?? '').trim();
    const termId = String(req.body?.termId ?? '').trim();

    if (!schoolCode || !admissionNo) {
      return res.status(400).json({ error: 'School code and admission number are required' });
    }

    const school = await resolveSchoolForPublicResultCheck(prisma, schoolCode);

    if (!school || !school.resultAccessPinEnabled) {
      return res.status(403).json({ error: 'Result PIN access is not enabled for this school' });
    }

    const mode = school.resultAccessMode || 'NONE';
    if (mode === 'PARENT_PORTAL_ONLY') {
      return res.status(403).json({ error: 'This school only allows parent-portal result access' });
    }

    const pupil = await prisma.pupil.findFirst({
      where: {
        schoolId: school.id,
        admissionNo,
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            phase: true,
          },
        },
      },
    });

    if (!pupil || !pupil.class) {
      return res.status(404).json({ error: 'Student record not found for the supplied admission number' });
    }

    // If PIN is not provided, ask for it
    if (!pin) {
      return res.status(403).json({ 
        error: 'PIN is required to view results',
        student: {
          id: pupil.id,
          firstName: pupil.firstName,
          lastName: pupil.lastName,
          admissionNo: pupil.admissionNo,
          className: pupil.class?.name ?? null,
        },
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          mode: school.resultAccessMode || 'NONE',
        },
      });
    }

    const candidates = await prisma.resultPin.findMany({
      where: {
        schoolId: school.id,
        status: 'ACTIVE',
        OR: [
          { studentId: pupil.id },
          { studentId: null },
        ],
        ...(termId ? { termId } : {}),
      },
      select: {
        id: true,
        pinHash: true,
        type: true,
        studentId: true,
        expiresAt: true,
        termId: true,
        assessmentId: true,
      },
      orderBy: { generatedAt: 'desc' },
    });

    const now = Date.now();
    let matchedPin: { id: string; type: string; studentId: string | null; termId: string | null; assessmentId: string | null } | null = null;

    for (const candidate of candidates) {
      if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < now) {
        continue;
      }

      const matches = await bcrypt.compare(pin, candidate.pinHash);
      if (!matches) {
        continue;
      }

      if (candidate.type === 'GENERIC' && !candidate.studentId) {
        await prisma.resultPin.update({
          where: { id: candidate.id },
          data: { studentId: pupil.id, assignedAt: new Date() },
        });
      }

      matchedPin = candidate;
      break;
    }

    if (!matchedPin) {
      return res.status(403).json({ error: 'The supplied PIN is invalid or has expired' });
    }

    const where: any = {
      schoolId: school.id,
      phase: pupil.class.phase,
      status: 'PUBLISHED',
    };

    if (termId && termId !== 'latest') {
      where.termId = termId;
    }

    const assessments = await prisma.assessment.findMany({
      where,
      include: {
        term: {
          select: { id: true, name: true, sortOrder: true },
        },
        results: {
          where: { pupilId: pupil.id },
          select: {
            id: true,
            caScore: true,
            testScore: true,
            examScore: true,
            totalScore: true,
          },
        },
      },
      orderBy: [
        { term: { sortOrder: 'desc' } },
        { createdAt: 'desc' },
      ],
    });

    const resultPayload = assessments.map((assessment) => {
      const result = assessment.results[0];
      const totalScore = result?.totalScore ?? null;
      return buildPublicResultPayloadItem({
        assessmentId: assessment.id,
        assessmentName: assessment.name ?? 'Assessment',
        termName: assessment.term?.name ?? 'Unknown term',
        termId: assessment.term?.id ?? null,
        totalScore,
        caScore: result?.caScore ?? null,
        testScore: result?.testScore ?? null,
        examScore: result?.examScore ?? null,
        grade: getPublicGrade(totalScore) ?? null,
      });
    });

    const reportCards = await Promise.all(
      assessments.map(async (assessment) => {
        try {
          const reportCardData = await reportCardService.generateReportCard(assessment.id, pupil.id, school.id);
          return {
            assessmentId: assessment.id,
            ...reportCardData,
          };
        } catch (error) {
          console.error('Error generating public report card payload:', error);
          return null;
        }
      })
    );

    res.json({
      ok: true,
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        mode: school.resultAccessMode || 'NONE',
      },
      student: {
        id: pupil.id,
        firstName: pupil.firstName,
        lastName: pupil.lastName,
        admissionNo: pupil.admissionNo,
        className: pupil.class?.name ?? null,
      },
      results: resultPayload,
      reportCards: reportCards.filter(Boolean),
      term: assessments[0]?.term ?? null,
    });
  } catch (error) {
    console.error('Error checking public result access:', error);
    res.status(500).json({ error: 'Failed to check results' });
  }
});

export default router;
