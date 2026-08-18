import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const schoolId = 'cmpfstpy30002ttiwhvivq6gt';
  const pins = await prisma.resultPin.findMany({
    where: { schoolId },
    select: { id: true, studentId: true, pinHash: true, pinValue: true, type: true, status: true, expiresAt: true, termId: true, assessmentId: true, generatedAt: true },
    orderBy: { generatedAt: 'desc' },
    take: 20,
  });
  console.log(JSON.stringify(pins, null, 2));
} finally {
  await prisma.$disconnect();
}
