import { execSync } from 'child_process';
import path from 'path';

// Generate Prisma Client pointing to the shared schema
const schemaPath = path.resolve(__dirname, '../packages/database/prisma/schema.prisma');

try {
  execSync(`npx prisma generate --schema ${schemaPath}`, {
    stdio: 'inherit',
  });
} catch (error) {
  console.error('Failed to generate Prisma client:', error);
  process.exit(1);
}
