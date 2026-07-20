export function normalizeGuardianProfileData(input: {
  guardianFirst?: string | null;
  guardianLast?: string | null;
  guardianEmail?: string | null;
  guardianPhone?: string | null;
  guardianAltPhone?: string | null;
  guardianOccupation?: string | null;
}) {
  const normalizeField = (value?: string | null, fallback: string | null = null) => {
    if (value === undefined || value === null) return fallback;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : fallback;
  };

  return {
    firstName: normalizeField(input.guardianFirst),
    lastName: normalizeField(input.guardianLast),
    email: normalizeField(input.guardianEmail),
    phone: normalizeField(input.guardianPhone, ''),
    altPhone: normalizeField(input.guardianAltPhone),
    occupation: normalizeField(input.guardianOccupation),
  };
}
