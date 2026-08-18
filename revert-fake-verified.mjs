import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function revertFakeVerified() {
  try {
    // Delete all SignupOtp records to remove fake verifications
    const deleted = await prisma.signupOtp.deleteMany({});
    
    console.log(`✓ Deleted ${deleted.count} fake SignupOtp records`);
    console.log('✓ All schools now show unverified (as they should)');
    console.log('\nOnly new signups that complete OTP verification will show as verified');
    
    await prisma.$disconnect();
  } catch (err) {
    console.error('Error:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

revertFakeVerified();
