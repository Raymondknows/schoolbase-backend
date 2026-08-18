/**
 * Database Health Check
 * 
 * This endpoint verifies database connectivity
 * Used by monitoring systems and deployment verification
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function checkDatabaseHealth() {
  try {
    // Simple query to test connection
    await prisma.$queryRaw`SELECT 1`;
    return { status: "connected", timestamp: new Date().toISOString() };
  } catch (error) {
    return {
      status: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    };
  }
}

// Export for use in health check endpoint
export default checkDatabaseHealth;
