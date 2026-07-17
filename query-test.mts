import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const schools = await prisma.school.findMany({
    select: { id: true, name: true, slug: true, initials: true, resultAccessPinEnabled: true, resultAccessMode: true },
    take: 10,
  });
  console.log('SCHOOLS');
  console.log(JSON.stringify(schools, null, 2));
  const pupils = await prisma.pupil.findMany({
    select: { id: true, schoolId: true, admissionNo: true, firstName: true, lastName: true, classId: true },
    take: 20,
  });
  console.log('PUPILS');
  console.log(JSON.stringify(pupils, null, 2));
} finally {
  await prisma.$disconnect();
}
