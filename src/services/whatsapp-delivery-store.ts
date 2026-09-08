import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

export interface WhatsAppDeliveryWriteInput {
  schoolId: string;
  event: string;
  recipientAddress: string;
  recipientName?: string | null;
  messageBody: string;
  status?: string;
  provider?: string | null;
  providerMessageId?: string | null;
  attemptCount?: number;
  guardianId?: string | null;
  lastError?: string | null;
  sentAt?: Date | null;
  nextAttemptAt?: Date | null;
}

export interface WhatsAppDeliveryQueryFilter {
  schoolId?: string;
  status?: string;
  limit?: number;
}

export function buildWhatsAppDeliveryHash(schoolId: string, recipientAddress: string, messageBody: string): string {
  return crypto.createHash('sha256').update(`${schoolId}|${recipientAddress}|${messageBody}`).digest('hex');
}

export function buildWhatsAppDeliveryPreview(messageBody: string, maxLength = 500): string {
  const safeMessage = String(messageBody || '').trim();
  if (safeMessage.length <= maxLength) return safeMessage;
  return `${safeMessage.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export class WhatsAppDeliveryStore {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertSchoolDelivery(input: WhatsAppDeliveryWriteInput) {
    const normalizedSchoolId = String(input.schoolId || '').trim();
    if (!normalizedSchoolId) {
      return null;
    }

    const hash = buildWhatsAppDeliveryHash(normalizedSchoolId, input.recipientAddress, input.messageBody);
    const preview = buildWhatsAppDeliveryPreview(input.messageBody, 500);

    return this.prisma.whatsAppDelivery.create({
      data: {
        schoolId: normalizedSchoolId,
        event: input.event,
        guardianId: input.guardianId ?? null,
        recipientAddress: input.recipientAddress,
        recipientName: input.recipientName ?? null,
        messageHash: hash,
        messagePreview: preview,
        status: input.status ?? 'QUEUED',
        provider: input.provider ?? null,
        providerMessageId: input.providerMessageId ?? null,
        attemptCount: input.attemptCount ?? 0,
        lastError: input.lastError ?? null,
        sentAt: input.sentAt ?? null,
        nextAttemptAt: input.nextAttemptAt ?? new Date(),
      },
    });
  }

  async updateById(id: string, updates: Partial<Pick<WhatsAppDeliveryWriteInput, 'status' | 'provider' | 'providerMessageId' | 'attemptCount' | 'lastError' | 'sentAt' | 'nextAttemptAt'>>) {
    return this.prisma.whatsAppDelivery.update({
      where: { id },
      data: {
        status: updates.status ?? undefined,
        provider: updates.provider ?? undefined,
        providerMessageId: updates.providerMessageId ?? undefined,
        attemptCount: updates.attemptCount ?? undefined,
        lastError: updates.lastError ?? undefined,
        sentAt: updates.sentAt ?? undefined,
        nextAttemptAt: updates.nextAttemptAt ?? undefined,
      },
    });
  }

  async getSchoolDeliveries(filter: WhatsAppDeliveryQueryFilter = {}) {
    const where: any = {};
    if (filter.schoolId) where.schoolId = filter.schoolId;
    if (filter.status) where.status = filter.status;

    return this.prisma.whatsAppDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit && filter.limit > 0 ? Math.min(filter.limit, 200) : 50,
    });
  }
}

export const whatsappDeliveryStore = new WhatsAppDeliveryStore(new PrismaClient());
