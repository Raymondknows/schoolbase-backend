export type AdmissionNoRecord = {
  id?: string | null;
  schoolId: string;
  admissionNo?: string | null;
};

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
