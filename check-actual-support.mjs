import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n=== CHECKING BOTH SUPPORT TABLES ===\n');
    
    // Check SupportRequest (school-level)
    const schoolSupportCount = await prisma.supportRequest.count();
    console.log(`SupportRequest (school-level): ${schoolSupportCount} records`);
    
    if (schoolSupportCount > 0) {
      const support = await prisma.supportRequest.findMany({
        include: {
          school: { select: { name: true } }
        }
      });
      console.log('\nSupportRequest details:');
      support.forEach((req, idx) => {
        console.log(`${idx + 1}. "${req.subject}" - Status: ${req.status}, Priority: ${req.priority}`);
        console.log(`   School: ${req.school?.name}`);
        console.log(`   Message: ${req.message.substring(0, 80)}...`);
        console.log(`   Response: ${req.response ? req.response.substring(0, 60) + '...' : 'None'}`);
      });
    }
    
    // Check PlatformSupportRequest
    console.log('\n---\n');
    const platformSupportCount = await prisma.platformSupportRequest.count();
    console.log(`PlatformSupportRequest (platform-level): ${platformSupportCount} records`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
