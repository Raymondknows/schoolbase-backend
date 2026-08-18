import { PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import {
  sendSubscriptionPaymentSuccessEmail,
  sendSubscriptionExpiryWarningEmail,
} from '../services/email.js';

const prisma = new PrismaClient();

interface EmailCheckResult {
  checked: number;
  emailsSent: number;
  errors: string[];
}

/**
 * Check for subscriptions expiring in 7 and 1 day and send warning emails
 */
export async function checkAndSendSubscriptionExpiryEmails(): Promise<EmailCheckResult> {
  const result: EmailCheckResult = {
    checked: 0,
    emailsSent: 0,
    errors: [],
  };

  try {
    const now = new Date();

    console.log(`[SubscriptionEmails] Starting expiry email check at ${now.toISOString()}`);

    // Check for schools expiring in 7 days
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    sevenDaysFromNow.setHours(0, 0, 0, 0);

    const schoolsExpiringIn7Days = await prisma.school.findMany({
      where: {
        status: 'ACTIVE',
        subscriptionExpiresAt: {
          gte: sevenDaysFromNow,
          lt: new Date(sevenDaysFromNow.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      select: {
        id: true,
        name: true,
        plan: true,
        subscriptionExpiresAt: true,
        users: {
          where: { role: 'SCHOOL_ADMIN' },
          select: { email: true, name: true },
          take: 1,
        },
      },
    });

    for (const school of schoolsExpiringIn7Days) {
      if (!school.users.length) continue;

      const admin = school.users[0];
      const expiryDate = new Date(school.subscriptionExpiresAt!).toLocaleDateString();

      try {
        await sendSubscriptionExpiryWarningEmail(
          admin.email,
          school.name,
          admin.name,
          7,
          expiryDate,
          school.plan
        );
        result.emailsSent++;
        console.log(`[SubscriptionEmails] ✓ 7-day warning sent to ${school.name} (${admin.email})`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to send 7-day warning to ${school.name}: ${errorMsg}`);
        console.error(`[SubscriptionEmails] ✗ Error sending 7-day warning:`, error);
      }
    }

    // Check for schools expiring in 1 day
    const oneDayFromNow = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    oneDayFromNow.setHours(0, 0, 0, 0);

    const schoolsExpiringIn1Day = await prisma.school.findMany({
      where: {
        status: 'ACTIVE',
        subscriptionExpiresAt: {
          gte: oneDayFromNow,
          lt: new Date(oneDayFromNow.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      select: {
        id: true,
        name: true,
        plan: true,
        subscriptionExpiresAt: true,
        users: {
          where: { role: 'SCHOOL_ADMIN' },
          select: { email: true, name: true },
          take: 1,
        },
      },
    });

    for (const school of schoolsExpiringIn1Day) {
      if (!school.users.length) continue;

      const admin = school.users[0];
      const expiryDate = new Date(school.subscriptionExpiresAt!).toLocaleDateString();

      try {
        await sendSubscriptionExpiryWarningEmail(
          admin.email,
          school.name,
          admin.name,
          1,
          expiryDate,
          school.plan
        );
        result.emailsSent++;
        console.log(`[SubscriptionEmails] ✓ 1-day warning sent to ${school.name} (${admin.email})`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Failed to send 1-day warning to ${school.name}: ${errorMsg}`);
        console.error(`[SubscriptionEmails] ✗ Error sending 1-day warning:`, error);
      }
    }

    result.checked = schoolsExpiringIn7Days.length + schoolsExpiringIn1Day.length;

    console.log(
      `[SubscriptionEmails] Job completed: ${result.emailsSent} emails sent, ${result.errors.length} errors`
    );
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Job failed: ${errorMsg}`);
    console.error('[SubscriptionEmails] ✗ Job error:', error);
    return result;
  }
}

/**
 * Initialize the subscription email check job
 * Runs every day at 8:00 AM UTC
 */
export function initializeSubscriptionEmailJob() {
  try {
    // Cron: 0 8 * * * = every day at 8:00 AM UTC
    const task = cron.schedule('0 8 * * *', async () => {
      console.log('[SubscriptionEmails] Cron job triggered');
      await checkAndSendSubscriptionExpiryEmails();
    });

    console.log('✓ Subscription email job initialized (runs daily at 8:00 AM UTC)');
    return task;
  } catch (error) {
    console.error('✗ Failed to initialize subscription email job:', error);
    throw error;
  }
}

/**
 * Stop the subscription email job (for graceful shutdown)
 */
export function stopSubscriptionEmailJob(task: any) {
  if (task) {
    task.stop();
    console.log('[SubscriptionEmails] Job stopped');
  }
}

/**
 * Send subscription payment success email
 * Call this directly after successful payment verification
 */
export async function sendPaymentSuccessEmail(
  email: string,
  schoolName: string,
  adminName: string,
  plan: string,
  amount: string,
  expiryDate: string
) {
  try {
    await sendSubscriptionPaymentSuccessEmail(email, schoolName, adminName, plan, amount, expiryDate);
    console.log(`[SubscriptionEmails] ✓ Payment success email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[SubscriptionEmails] ✗ Error sending payment success email:', error);
    throw error;
  }
}
