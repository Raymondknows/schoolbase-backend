import { createHmac, timingSafeEqual } from 'node:crypto';

function isValidPaymentEmail(value?: string | null): value is string {
  const email = value?.trim();
  return Boolean(email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export function resolveIdCardPayerEmail(accountEmail?: string | null, schoolEmail?: string | null) {
  if (isValidPaymentEmail(accountEmail)) return accountEmail.trim();
  if (isValidPaymentEmail(schoolEmail)) return schoolEmail.trim();
  return null;
}

export function verifyPaystackSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type IdCardPreflightStudent = {
  id: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  photoUrl?: string | null;
  admissionNo?: string | null;
  class?: unknown | null;
};

export function buildIdCardPreflightWarnings(students: IdCardPreflightStudent[]) {
  return students.flatMap((student) => {
    const pupilName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
    const warnings: Array<{ pupilId: string; pupilName: string; field: 'photo' | 'admissionNo' | 'class'; message: string }> = [];
    if (!student.photoUrl) warnings.push({ pupilId: student.id, pupilName, field: 'photo', message: 'No photo; initials will be used.' });
    if (!student.admissionNo?.trim()) warnings.push({ pupilId: student.id, pupilName, field: 'admissionNo', message: 'No admission number is assigned.' });
    if (!student.class) warnings.push({ pupilId: student.id, pupilName, field: 'class', message: 'No class is assigned.' });
    return warnings;
  });
}