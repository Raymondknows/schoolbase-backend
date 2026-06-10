const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    // Get school count by status
    const schoolsByStatus = await prisma.school.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    // Get total schools
    const totalSchools = await prisma.school.count();

    // Get schools with details
    const schools = await prisma.school.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true,
        country: true,
        createdAt: true,
        _count: {
          select: { users: true, pupils: true, classes: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Get user count by role
    const usersByRole = await prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
    });

    // Get total users
    const totalUsers = await prisma.user.count();

    // Get trial schools ending soon
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const trialEnding = await prisma.school.count({
      where: {
        status: 'TRIAL',
        trialEndsAt: {
          lte: thirtyDaysFromNow
        }
      }
    });

    console.log('\n=== SCHOOLS AUDIT ===\n');
    console.log(`Total Schools: ${totalSchools}`);
    console.log('\nSchools by Status:');
    schoolsByStatus.forEach(row => {
      console.log(`  ${row.status}: ${row._count.id}`);
    });

    console.log('\nLatest 10 Schools:');
    schools.forEach((school, idx) => {
      console.log(`  ${idx + 1}. ${school.name} (${school.slug})`);
      console.log(`     Status: ${school.status}, Plan: ${school.plan}, Country: ${school.country}`);
      console.log(`     Users: ${school._count.users}, Pupils: ${school._count.pupils}, Classes: ${school._count.classes}`);
      console.log(`     Created: ${school.createdAt.toLocaleDateString()}`);
    });

    console.log('\n=== USERS AUDIT ===\n');
    console.log(`Total Users: ${totalUsers}`);
    console.log('\nUsers by Role:');
    usersByRole.forEach(row => {
      console.log(`  ${row.role}: ${row._count.id}`);
    });

    console.log('\n=== TRIAL STATUS ===\n');
    console.log(`Trial Schools Ending in 30 days: ${trialEnding}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
