import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  try {
    const schools = await prisma.school.findMany({ select: { id: true, name: true, slug: true, status: true } });
    console.log(JSON.stringify(schools, null, 2));
  } catch (err) {
    console.error('Error listing schools:', err);
  } finally {
    await prisma.$disconnect();
  }
})();
