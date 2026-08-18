import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n=== CHECKING PLATFORM SETTINGS ===\n');
    
    const settings = await prisma.platformSetting.findMany();
    console.log(`Total settings: ${settings.length}`);
    
    if (settings.length > 0) {
      console.log('\nSettings details:');
      settings.forEach((s, idx) => {
        console.log(`${idx + 1}. Key: "${s.key}" = "${s.value}"`);
      });
    } else {
      console.log('\nNo settings found in database. Database is empty.');
      console.log('Inserting sample settings...');
      
      await prisma.platformSetting.createMany({
        data: [
          { key: 'platformName', value: 'SchoolBase' },
          { key: 'supportEmail', value: 'support@schoolbase.live' },
          { key: 'supportPhone', value: '+234 903 136 8963' },
          { key: 'maintenanceMode', value: 'false' },
          { key: 'maxSchools', value: '100' },
        ],
      });
      
      const newSettings = await prisma.platformSetting.findMany();
      console.log('\nNew settings inserted:');
      newSettings.forEach((s, idx) => {
        console.log(`${idx + 1}. Key: "${s.key}" = "${s.value}"`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
