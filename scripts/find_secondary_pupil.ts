import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pupil = await prisma.pupil.findFirst({
    where: { class: { is: { phase: 'SECONDARY' } } },
    include: { class: true, school: true },
  });

  if (!pupil) {
    console.log('NO_PUPIL_FOUND');
    return;
  }

  console.log(JSON.stringify({ pupilId: pupil.id, schoolId: pupil.schoolId, classPhase: pupil.class?.phase, pupil }, null, 2));
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
