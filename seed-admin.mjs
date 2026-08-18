import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Hash the password
  const passwordHash = await bcrypt.hash('Success1&', 10);
  
  // Create or update the platform admin user
  const user = await prisma.user.upsert({
    where: { email: 'admin@schoolbase.live' },
    update: {
      passwordHash,
      name: 'SchoolBase Admin',
      role: 'PLATFORM_ADMIN',
    },
    create: {
      email: 'admin@schoolbase.live',
      name: 'SchoolBase Admin',
      role: 'PLATFORM_ADMIN',
      passwordHash,
    },
  });
  
  console.log('Platform admin created/updated:', user);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
