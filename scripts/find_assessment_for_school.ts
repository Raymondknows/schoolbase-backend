import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main(){
  const schoolId = 'cmpfstpy30002ttiwhvivq6gt';
  const assessments = await prisma.assessment.findMany({ where: { schoolId }, take: 10 });
  console.log(JSON.stringify(assessments.map(a=>({ id: a.id, name: a.name, classId: a.classId, phase: a.phase })), null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
