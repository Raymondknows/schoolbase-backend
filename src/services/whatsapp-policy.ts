export interface SchoolWhatsAppPolicy {
  schoolId: string;
  enabled: boolean;
  messagesPerMinute: number;
  messagesPerHour: number;
  messagesPerDay: number;
  batchSize: number;
  batchCooldownSeconds: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  requireApprovalForBulk: boolean;
  allowAutomaticRetries: boolean;
  timezone: string;
  updatedAt: Date;
}

export interface WhatsAppSendEvaluationInput {
  recipientCount?: number;
  now?: Date;
  timezone?: string;
  force?: boolean;
  approvedForBulk?: boolean;
}

export interface WhatsAppSendEvaluationResult {
  allowed: boolean;
  reason?: string;
}

export function getDefaultWhatsAppPolicy(schoolId: string): SchoolWhatsAppPolicy {
  return {
    schoolId: String(schoolId || '').trim() || 'default-school',
    enabled: true,
    messagesPerMinute: 10,
    messagesPerHour: 100,
    messagesPerDay: 300,
    batchSize: 25,
    batchCooldownSeconds: 120,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
    requireApprovalForBulk: true,
    allowAutomaticRetries: true,
    timezone: 'Africa/Lagos',
    updatedAt: new Date(),
  };
}

export async function readSchoolWhatsAppPolicy(prisma: { whatsAppPolicy?: { findUnique: (args: any) => Promise<any> } }, schoolId: string): Promise<SchoolWhatsAppPolicy> {
  const defaultPolicy = getDefaultWhatsAppPolicy(schoolId);
  const policyRecord = prisma.whatsAppPolicy ? await prisma.whatsAppPolicy.findUnique({ where: { schoolId } }) : null;

  if (!policyRecord) {
    return defaultPolicy;
  }

  return {
    ...defaultPolicy,
    ...policyRecord,
    schoolId: policyRecord.schoolId ?? defaultPolicy.schoolId,
    updatedAt: policyRecord.updatedAt ? new Date(policyRecord.updatedAt) : defaultPolicy.updatedAt,
  };
}

export function evaluateSchoolWhatsAppSend(policy: SchoolWhatsAppPolicy, input: WhatsAppSendEvaluationInput = {}): WhatsAppSendEvaluationResult {
  if (!policy.enabled) {
    return { allowed: false, reason: 'WhatsApp is disabled for this school.' };
  }

  if (input.force) {
    return { allowed: true };
  }

  const recipientCount = Math.max(0, Number(input.recipientCount ?? 1));
  const now = input.now ?? new Date();
  const timezone = input.timezone ?? policy.timezone ?? 'Africa/Lagos';

  if (recipientCount > policy.batchSize && policy.requireApprovalForBulk && !input.approvedForBulk) {
    return {
      allowed: false,
      reason: `Bulk send rejected: ${recipientCount} recipients exceeds the configured batch size of ${policy.batchSize}. Approval is required.`,
    };
  }

  const quietHours = isWithinQuietHours(now, timezone, policy.quietHoursStart, policy.quietHoursEnd);
  if (quietHours) {
    return {
      allowed: false,
      reason: `Quiet hours are active for ${timezone}. Auto WhatsApp sends are paused between ${policy.quietHoursStart} and ${policy.quietHoursEnd}.`,
    };
  }

  return { allowed: true };
}

function isWithinQuietHours(date: Date, timezone: string, quietHoursStart: string, quietHoursEnd: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const local = formatter.format(date);
    const [hours, minutes] = local.split(':').map(Number);
    const currentMinutes = hours * 60 + minutes;

    const [startHours, startMinutes] = quietHoursStart.split(':').map(Number);
    const [endHours, endMinutes] = quietHoursEnd.split(':').map(Number);

    const startMinutesValue = startHours * 60 + startMinutes;
    const endMinutesValue = endHours * 60 + endMinutes;

    if (startMinutesValue < endMinutesValue) {
      return currentMinutes >= startMinutesValue && currentMinutes < endMinutesValue;
    }

    return currentMinutes >= startMinutesValue || currentMinutes < endMinutesValue;
  } catch {
    return false;
  }
}

export function getPersistedSchoolWhatsAppPolicyRecord(policy: SchoolWhatsAppPolicy) {
  return {
    schoolId: policy.schoolId,
    enabled: policy.enabled,
    messagesPerMinute: policy.messagesPerMinute,
    messagesPerHour: policy.messagesPerHour,
    messagesPerDay: policy.messagesPerDay,
    batchSize: policy.batchSize,
    batchCooldownSeconds: policy.batchCooldownSeconds,
    quietHoursStart: policy.quietHoursStart,
    quietHoursEnd: policy.quietHoursEnd,
    requireApprovalForBulk: policy.requireApprovalForBulk,
    allowAutomaticRetries: policy.allowAutomaticRetries,
    timezone: policy.timezone,
    updatedAt: policy.updatedAt,
  };
}
