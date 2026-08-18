export type AdmissionStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

const STATUS_VALUES: Record<string, AdmissionStatus> = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const STATUS_LABELS: Record<AdmissionStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export function normalizeAdmissionStatus(value?: string | null): AdmissionStatus {
  if (!value) return 'SUBMITTED';
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, '_');
  return STATUS_VALUES[normalized] ?? 'SUBMITTED';
}

export function getAdmissionStatusLabel(status?: string | null): string {
  const normalized = normalizeAdmissionStatus(status);
  return STATUS_LABELS[normalized] ?? STATUS_LABELS.SUBMITTED;
}
