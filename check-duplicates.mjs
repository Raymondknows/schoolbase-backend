import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  console.log('Checking for duplicate AcademicYears...');
  const ayDupes = await prisma.$queryRaw`
    SELECT schoolId, name, COUNT(*) as cnt FROM AcademicYear 
    GROUP BY schoolId, name HAVING cnt > 1
  `;
  console.log('AcademicYear dupes:', ayDupes.length ? ayDupes : 'None found ✓');

  console.log('\nChecking for duplicate Classes...');
  const classDupes = await prisma.$queryRaw`
    SELECT schoolId, name, phase, COUNT(*) as cnt FROM Class 
    GROUP BY schoolId, name, phase HAVING cnt > 1
  `;
  console.log('Class dupes:', classDupes.length ? classDupes : 'None found ✓');
  
  await prisma.$disconnect();
}
check().catch(console.error);
