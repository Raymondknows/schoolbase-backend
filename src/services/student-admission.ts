export type AdmissionNoRecord = {
  id?: string | null;
  schoolId: string;
  admissionNo?: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferAdmissionPrefix(schoolName?: string | null, schoolInitials?: string | null): string {
  const initials = (schoolInitials ?? '').trim();
  if (initials) {
    return initials.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SCH';
  }

  const name = (schoolName ?? '').trim();
  if (!name) {
    return 'SCH';
  }

  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let letters = words.slice(0, 3).map((word) => word[0]).join('').toUpperCase();

  if (letters.length < 3 && words[0]) {
    const remaining = words[0].slice(1).replace(/[^A-Za-z0-9]/g, '');
    for (const ch of remaining) {
      letters += ch.toUpperCase();
      if (letters.length >= 3) break;
    }
  }

  return (letters || 'SCH').replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'SCH';
}

export function getNextAdmissionNo({
  schoolId,
  schoolName,
  schoolInitials,
  year,
  existingRecords,
  prefix,
}: {
  schoolId?: string | null;
  schoolName?: string | null;
  schoolInitials?: string | null;
  year?: number | null;
  existingRecords: AdmissionNoRecord[];
  prefix?: string | null;
}): string {
  const currentYear = Number(year ?? new Date().getFullYear()) || new Date().getFullYear();
  const resolvedPrefix = (prefix ?? inferAdmissionPrefix(schoolName, schoolInitials))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6) || 'SCH';

  const pattern = new RegExp(`^${escapeRegExp(resolvedPrefix)}-${currentYear}-(\\d+)$`, 'i');
  let maxSequence = 0;

  for (const record of existingRecords) {
    if (schoolId && record.schoolId && record.schoolId !== schoolId) {
      continue;
    }

    const admissionNo = normalizeAdmissionNo(record.admissionNo);
    if (!admissionNo) {
      continue;
    }

    const match = admissionNo.match(pattern);
    if (!match) {
      continue;
    }

    const sequence = Number(match[1]);
    if (Number.isFinite(sequence)) {
      maxSequence = Math.max(maxSequence, sequence);
    }
  }

  const nextSequence = String(maxSequence + 1).padStart(4, '0');
  return `${resolvedPrefix}-${currentYear}-${nextSequence}`;
}

export function normalizeAdmissionNo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, '').toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function validateUniqueAdmissionNo({
  schoolId,
  admissionNo,
  currentStudentId,
  existingRecords,
}: {
  schoolId: string;
  admissionNo: string | null | undefined;
  currentStudentId?: string | null;
  existingRecords: AdmissionNoRecord[];
}): { isValid: boolean; error?: string } {
  const normalized = normalizeAdmissionNo(admissionNo);

  if (!normalized) {
    return { isValid: true };
  }

  const duplicateEntry = existingRecords.find((record) => {
    if (record.schoolId !== schoolId) {
      return false;
    }

    const existingAdmissionNo = normalizeAdmissionNo(record.admissionNo);
    if (!existingAdmissionNo || existingAdmissionNo !== normalized) {
      return false;
    }

    if (currentStudentId && record.id && record.id === currentStudentId) {
      return false;
    }

    return true;
  });

  if (duplicateEntry) {
    return {
      isValid: false,
      error: `Admission number "${normalized}" already exists for this school. Please choose a unique value.`,
    };
  }

  return { isValid: true };
}
