import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n=== SUPPORT DATA ===\n');
    const supportCount = await prisma.platformSupportRequest?.count?.() ?? 0;
    console.log(`Total support requests: ${supportCount}`);
    
    if (supportCount > 0) {
      const support = await prisma.platformSupportRequest?.findMany?.({ take: 3 }) ?? [];
      console.log('Sample:');
      support.forEach(s => console.log(`  - ${s.subject} (${s.status})`));
    }

    console.log('\n=== SETUP REMINDERS DATA ===\n');
    // Check if table exists by trying to count
    try {
      const setupCount = await prisma.setupReminder?.count?.() ?? 0;
      console.log(`Setup reminders found: ${setupCount}`);
    } catch (e) {
      console.log('Setup reminders table: NOT FOUND in schema');
    }

    console.log('\n=== SUBSCRIPTIONS DATA ===\n');
    // Schools have status and plan fields
    const activeSchools = await prisma.school.count({ where: { status: 'ACTIVE' } });
    const trialSchools = await prisma.school.count({ where: { status: 'TRIAL' } });
    const suspendedSchools = await prisma.school.count({ where: { status: 'SUSPENDED' } });
    
    console.log(`Active schools: ${activeSchools}`);
    console.log(`Trial schools: ${trialSchools}`);
    console.log(`Suspended schools: ${suspendedSchools}`);

    const schoolsByPlan = await prisma.school.groupBy({
      by: ['plan'],
      _count: { id: true }
    });
    console.log('\nSchools by plan:');
    schoolsByPlan.forEach(row => {
      console.log(`  ${row.plan}: ${row._count.id}`);
    });

    // Get schools with subscription expiry info
    const schoolsWithExpiry = await prisma.school.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        plan: true,
        subscriptionExpiresAt: true,
        trialEndsAt: true,
        onboardingStatus: true,
        onboardingProgress: true
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    console.log('\nSchool subscription details:');
    schoolsWithExpiry.forEach(s => {
      console.log(`  ${s.name}:`);
      console.log(`    Status: ${s.status}, Plan: ${s.plan}`);
      console.log(`    Trial ends: ${s.trialEndsAt ? new Date(s.trialEndsAt).toLocaleDateString() : 'N/A'}`);
      console.log(`    Subscription expires: ${s.subscriptionExpiresAt ? new Date(s.subscriptionExpiresAt).toLocaleDateString() : 'N/A'}`);
      console.log(`    Onboarding: ${s.onboardingStatus} (${s.onboardingProgress}%)`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
