import assert from 'assert';
import { PrismaClient } from '@prisma/client';
import { resolveSchoolForPublicResultCheck } from '../src/routes/public.js';

async function main() {
  const prisma = new PrismaClient();

  try {
    const schoolByName = await resolveSchoolForPublicResultCheck(prisma, 'Greenfield Academy');
    assert.ok(schoolByName, 'Expected lookup by school display name to resolve a school');
    assert.equal(schoolByName?.name, 'Greenfield Academy');

    const schoolBySlug = await resolveSchoolForPublicResultCheck(prisma, 'greenfield');
    assert.ok(schoolBySlug, 'Expected lookup by school slug to resolve a school');
    assert.equal(schoolBySlug?.slug, 'greenfield');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
