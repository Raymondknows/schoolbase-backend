import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const schoolId = 'cmpfstpy30002ttiwhvivq6gt';
  const pupilId = 'cmpvll7110001ttuz3xx8joa3';
  const pupil = await prisma.pupil.findUnique({ where: { id: pupilId }, include: { class: { select: { id: true, name: true, phase: true } } } });
  console.log('PUPIL', JSON.stringify(pupil, null, 2));
  const assessments = await prisma.assessment.findMany({
    where: { schoolId, phase: pupil?.class?.phase, status: 'PUBLISHED', publishedAt: { not: null } },
    include: { term: { select: { id: true, name: true, sortOrder: true } }, results: { where: { pupilId }, select: { id: true, caScore: true, testScore: true, examScore: true, totalScore: true } } },
    orderBy: [{ term: { sortOrder: 'desc' } }, { createdAt: 'desc' }],
    take: 20,
  });
  console.log('ASSESSMENTS', JSON.stringify(assessments, null, 2));
} finally {
  await prisma.$disconnect();
}
