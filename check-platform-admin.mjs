import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n=== CHECKING PLATFORM ADMIN USERS ===\n');
    
    const admins = await prisma.user.findMany({
      where: { role: 'PLATFORM_ADMIN' }
    });
    
    console.log(`Total PLATFORM_ADMIN users: ${admins.length}`);
    
    if (admins.length > 0) {
      console.log('\nPlatform Admin details:');
      admins.forEach((admin, idx) => {
        console.log(`${idx + 1}. ID: ${admin.id}`);
        console.log(`   Email: ${admin.email}`);
        console.log(`   Name: ${admin.name}`);
        console.log(`   Role: ${admin.role}`);
        console.log(`   Created: ${admin.createdAt}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
