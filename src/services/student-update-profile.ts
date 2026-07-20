type StudentProfileLike = {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  classId?: string | null;
  status?: string | null;
  admissionDate?: Date | string | null;
  gender?: string | null;
  dateOfBirth?: Date | string | null;
  studentEmail?: string | null;
  studentPhone?: string | null;
  address?: string | null;
  bloodGroup?: string | null;
  genotype?: string | null;
  medicalNotes?: string | null;
  previousSchool?: string | null;
  previousClass?: string | null;
};

function normalizeField(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function buildStudentUpdateData(input: StudentProfileLike, current: StudentProfileLike) {
  const firstName = normalizeField(input.firstName) ?? current.firstName ?? null;
  const middleName = normalizeField(input.middleName) ?? current.middleName ?? null;
  const lastName = normalizeField(input.lastName) ?? current.lastName ?? null;
  const classId = normalizeField(input.classId) ?? current.classId ?? null;
  const status = normalizeField(input.status) ?? current.status ?? null;
  const admissionDate = normalizeDate(input.admissionDate) ?? (current.admissionDate ? new Date(current.admissionDate) : null);
  const gender = normalizeField(input.gender) ?? current.gender ?? null;
  const dateOfBirth = normalizeDate(input.dateOfBirth) ?? (current.dateOfBirth ? new Date(current.dateOfBirth) : null);
  const studentEmail = normalizeField(input.studentEmail) ?? current.studentEmail ?? null;
  const studentPhone = normalizeField(input.studentPhone) ?? current.studentPhone ?? null;
  const address = normalizeField(input.address) ?? current.address ?? null;
  const bloodGroup = normalizeField(input.bloodGroup) ?? current.bloodGroup ?? null;
  const genotype = normalizeField(input.genotype) ?? current.genotype ?? null;
  const medicalNotes = normalizeField(input.medicalNotes) ?? current.medicalNotes ?? null;
  const previousSchool = normalizeField(input.previousSchool) ?? current.previousSchool ?? null;
  const previousClass = normalizeField(input.previousClass) ?? current.previousClass ?? null;

  return {
    firstName,
    middleName,
    lastName,
    classId,
    status,
    admissionDate,
    gender,
    dateOfBirth,
    studentEmail,
    studentPhone,
    address,
    bloodGroup,
    genotype,
    medicalNotes,
    previousSchool,
    previousClass,
  };
}
