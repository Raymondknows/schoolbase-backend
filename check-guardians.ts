import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { resolveGuardianNotificationTargets } from './src/services/guardian-notification-recipients.ts';

async function main() {
  const prisma = new PrismaClient();
  try {
    const school = await prisma.school.findFirst({ select: { id: true, name: true, slug: true } });
    console.log('school', school);
    const pupils = await prisma.pupil.findMany({ where: { schoolId: school?.id }, take: 10, include: { guardians: { include: { guardian: true } } } });
    for (const pupil of pupils) {
      const targets = resolveGuardianNotificationTargets(pupil.guardians.map((entry: any) => ({ guardian: entry.guardian })));
      console.log('pupil', pupil.id, pupil.firstName, pupil.lastName);
      console.log(JSON.stringify(targets, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
