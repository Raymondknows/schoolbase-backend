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

export class WhatsAppDeliveryWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rateLimiter: SchoolWhatsAppRateLimiter = new SchoolWhatsAppRateLimiter(),
  ) {}

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

      await this.prisma.whatsAppDelivery.update({
        where: { id: delivery.id },
        data: {
          status: outcome.success ? 'SENT' : 'FAILED',
          provider: outcome.providerMessageId ? 'baileys' : undefined,
          providerMessageId: outcome.providerMessageId ?? undefined,
          attemptCount: delivery.attemptCount + 1,
          lastError: outcome.success ? null : outcome.error ?? null,
          sentAt: outcome.success ? new Date() : undefined,
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      });
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
