import { PrismaClient } from '@prisma/client';
import { SchoolWhatsAppRateLimiter } from './whatsapp-rate-limiter.js';

export interface DurablyQueuedDelivery {
  id: string;
  schoolId: string;
  event: string;
  recipientAddress: string;
  messagePreview: string | null;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date;
  guardianId?: string | null;
  provider?: string | null;
  lastError?: string | null;
}

export interface DeliveryWorkerResult {
  processed: number;
  skipped: number;
  remaining: number;
}

export async function collectQueuedSchoolIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.whatsAppDelivery.findMany({
    where: { status: 'QUEUED' },
    select: { schoolId: true },
    distinct: ['schoolId'],
  });

  return [...new Set(rows.map((row) => String(row.schoolId || '').trim()).filter(Boolean))];
}

export class WhatsAppDeliveryWorker {
  private pollTimer: NodeJS.Timeout | null = null;
  private schoolsInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly rateLimiter: SchoolWhatsAppRateLimiter = new SchoolWhatsAppRateLimiter(),
  ) {}

  startPolling(
    sender: (delivery: DurablyQueuedDelivery) => Promise<{ success: boolean; providerMessageId?: string; error?: string }>,
    options: { intervalMs?: number } = {},
  ): NodeJS.Timeout {
    const intervalMs = options.intervalMs ?? 5_000;
    if (this.pollTimer) {
      return this.pollTimer;
    }

    void this.pollQueuedSchools(sender);
    this.pollTimer = setInterval(() => {
      void this.pollQueuedSchools(sender);
    }, intervalMs);
    this.pollTimer.unref?.();
    return this.pollTimer;
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollQueuedSchools(
    sender: (delivery: DurablyQueuedDelivery) => Promise<{ success: boolean; providerMessageId?: string; error?: string }>,
  ) {
    const queuedSchools = await collectQueuedSchoolIds(this.prisma);
    for (const schoolId of queuedSchools) {
      if (this.schoolsInFlight.has(schoolId)) {
        continue;
      }

      this.schoolsInFlight.add(schoolId);
      try {
        await this.processSchoolQueue(schoolId, sender);
      } catch (error) {
        console.error(`[whatsapp-worker] Failed to process queued school ${schoolId}:`, error);
      } finally {
        this.schoolsInFlight.delete(schoolId);
      }
    }
  }

  async processSchoolQueue(
    schoolId: string,
    sender: (delivery: DurablyQueuedDelivery) => Promise<{ success: boolean; providerMessageId?: string; error?: string }>,
  ): Promise<DeliveryWorkerResult> {
    const normalizedSchoolId = String(schoolId || '').trim();
    if (!normalizedSchoolId) {
      return { processed: 0, skipped: 0, remaining: 0 };
    }

    const pending = await this.prisma.whatsAppDelivery.findMany({
      where: {
        schoolId: normalizedSchoolId,
        status: 'QUEUED',
      },
      orderBy: { nextAttemptAt: 'asc' },
    });

    let processed = 0;
    let skipped = 0;

    for (const delivery of pending) {
      const allowed = await this.rateLimiter.tryAcquire(normalizedSchoolId);
      if (!allowed) {
        skipped += 1;
        continue;
      }

      const outcome = await sender({
        id: delivery.id,
        schoolId: delivery.schoolId,
        event: delivery.event,
        recipientAddress: delivery.recipientAddress,
        messagePreview: delivery.messagePreview,
        status: delivery.status,
        attemptCount: delivery.attemptCount,
        nextAttemptAt: delivery.nextAttemptAt,
        guardianId: delivery.guardianId,
        provider: delivery.provider,
        lastError: delivery.lastError,
      });

      processed += 1;

      const nextStatus = outcome.success ? 'SENT' : 'FAILED';
      await this.prisma.whatsAppDelivery.update({
        where: { id: delivery.id },
        data: {
          status: nextStatus,
          provider: outcome.providerMessageId ? 'baileys' : undefined,
          providerMessageId: outcome.providerMessageId ?? undefined,
          attemptCount: delivery.attemptCount + 1,
          lastError: outcome.success ? null : outcome.error ?? null,
          sentAt: outcome.success ? new Date() : undefined,
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      });

      if (delivery.guardianId) {
        const matchingNotifications = await this.prisma.notification.findMany({
          where: {
            schoolId: normalizedSchoolId,
            guardianId: delivery.guardianId,
            channel: 'WHATSAPP',
            status: 'PENDING',
            body: delivery.messagePreview || '',
          },
          select: { id: true },
        });

        for (const notification of matchingNotifications) {
          await this.prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: outcome.success ? 'SENT' : 'FAILED',
              sentAt: outcome.success ? new Date() : undefined,
              failureReason: outcome.success ? null : outcome.error ?? 'Queued retry failed',
            },
          });
        }
      }
    }

    let remaining = 0;
    if (typeof (this.prisma.whatsAppDelivery as any).count === 'function') {
      remaining = await this.prisma.whatsAppDelivery.count({
        where: { schoolId: normalizedSchoolId, status: 'QUEUED' },
      });
    } else {
      const remainingRows = await this.prisma.whatsAppDelivery.findMany({
        where: { schoolId: normalizedSchoolId, status: 'QUEUED' },
        select: { id: true },
      });
      remaining = remainingRows.length;
    }

    return { processed, skipped, remaining };
  }
}

export const whatsappDeliveryWorker = new WhatsAppDeliveryWorker(new PrismaClient());
