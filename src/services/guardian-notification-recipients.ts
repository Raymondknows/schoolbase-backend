export interface GuardianNotificationRecipientInput {
  guardian: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
    altPhone?: string | null;
  };
}

export interface GuardianNotificationTarget {
  guardian: GuardianNotificationRecipientInput['guardian'];
  recipients: Array<{
    channel: 'EMAIL' | 'WHATSAPP';
    address: string;
    name: string;
  }>;
}

function normalizeContactValue(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildGuardianNotificationRecipients(
  guardian: GuardianNotificationRecipientInput['guardian'],
): GuardianNotificationTarget['recipients'] {
  const normalizedEmail = normalizeContactValue(guardian.email);
  const normalizedWhatsApp = normalizeContactValue(guardian.whatsapp)
    || normalizeContactValue(guardian.phone)
    || normalizeContactValue((guardian as { altPhone?: string | null }).altPhone);

  const name = [guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim() || 'Guardian';

  return [
    ...(normalizedEmail ? [{ channel: 'EMAIL' as const, address: normalizedEmail, name }] : []),
    ...(normalizedWhatsApp ? [{ channel: 'WHATSAPP' as const, address: normalizedWhatsApp, name }] : []),
  ];
}

export function resolveGuardianNotificationTargets(
  guardians: GuardianNotificationRecipientInput[],
  selectedGuardianIds?: string[] | null,
): GuardianNotificationTarget[] {
  const selectedIds = new Set((selectedGuardianIds || []).filter((id): id is string => Boolean(id && String(id).trim())));

  return guardians
    .filter((entry) => {
      const guardianId = entry.guardian?.id;
      return !guardianId || !selectedIds.size || selectedIds.has(guardianId);
    })
    .map((entry) => {
      const guardian = entry.guardian;
      const recipients = buildGuardianNotificationRecipients(guardian);

      return {
        guardian,
        recipients,
      };
    })
    .filter((target) => target.recipients.length > 0);
}
