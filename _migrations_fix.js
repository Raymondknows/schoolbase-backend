const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  try {
    // Insert the migration as applied
    await prisma.$executeRaw`
      INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES ('20260612_consolidated_schema', '123', NOW(), '20260612_consolidated_schema', NULL, NULL, NOW(), 1)
    `;
    console.log('✅ Migration marked as applied');
    process.exit(0);
  } catch (e) {
    if (e.message.includes('Duplicate entry')) {
      console.log('✅ Migration already recorded');
      process.exit(0);
    }
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fix();
