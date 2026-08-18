import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';

const prisma = new PrismaClient();

interface SubscriptionCheckResult {
  checked: number;
  suspended: number;
  errors: string[];
}

/**
 * Check for expired subscriptions and auto-suspend them
 * Runs daily at 2:00 AM UTC
 */
export async function checkAndSuspendExpiredSubscriptions(): Promise<SubscriptionCheckResult> {
  const result: SubscriptionCheckResult = {
    checked: 0,
    suspended: 0,
    errors: [],
  };

  try {
    const now = new Date();
    
    console.log(`[SubscriptionExpiry] Starting expiry check at ${now.toISOString()}`);

    // Find all ACTIVE schools where subscriptionExpiresAt is in the past
    const expiredSchools = await prisma.school.findMany({
      where: {
        status: 'ACTIVE',
        subscriptionExpiresAt: {
          lt: now, // Less than current time = expired
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        subscriptionExpiresAt: true,
      },
    });

    result.checked = expiredSchools.length;
    console.log(`[SubscriptionExpiry] Found ${expiredSchools.length} expired subscriptions`);

    // Suspend each expired school
    for (const school of expiredSchools) {
      try {
        const updated = await prisma.school.update({
          where: { id: school.id },
          data: {
            status: 'SUSPENDED',
          },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            subscriptionExpiresAt: true,
          },
        });

        result.suspended++;
        console.log(
          `[SubscriptionExpiry] ✓ Suspended school: ${updated.name} (${updated.slug}) - expired at ${school.subscriptionExpiresAt}`
        );

        // TODO: Send email notification to school admin about suspension
        // TODO: Log this action to audit table for compliance
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to suspend ${school.name}: ${errorMsg}`);
        console.error(`[SubscriptionExpiry] ✗ Error suspending ${school.name}:`, error);
      }
    }

    console.log(
      `[SubscriptionExpiry] Job completed: ${result.suspended} suspended, ${result.errors.length} errors`
    );
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Job failed: ${errorMsg}`);
    console.error('[SubscriptionExpiry] ✗ Job error:', error);
    return result;
  }
}

/**
 * Initialize the subscription expiry check job
 * Runs at 2:00 AM UTC every day
 */
export function initializeSubscriptionExpiryJob() {
  try {
    // Cron: 0 2 * * * = every day at 2:00 AM UTC
    const task = cron.schedule('0 2 * * *', async () => {
      console.log('[SubscriptionExpiry] Cron job triggered');
      await checkAndSuspendExpiredSubscriptions();
    });

    console.log('✓ Subscription expiry job initialized (runs daily at 2:00 AM UTC)');
    return task;
  } catch (error) {
    console.error('✗ Failed to initialize subscription expiry job:', error);
    throw error;
  }
}

/**
 * Stop the subscription expiry job (for graceful shutdown)
 */
export function stopSubscriptionExpiryJob(task: any) {
  if (task) {
    task.stop();
    console.log('[SubscriptionExpiry] Job stopped');
  }
}
