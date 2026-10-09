export interface CompetitionAudience {
  minimumAge: number;
  maximumAge: number;
  classLabel: string;
}

function normalizeClassLabel(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseCompetitionAudience(label: string | null | undefined): CompetitionAudience | null {
  if (!label) return null;
  const match = label.trim().match(/^Ages\s+(\d{1,2})-(\d{1,2})\s+·\s+(.+)$/i);
  if (!match) return null;
  const minimumAge = Number(match[1]);
  const maximumAge = Number(match[2]);
  const classLabel = match[3]?.trim() ?? '';
  if (minimumAge < 2 || maximumAge > 25 || minimumAge > maximumAge || !classLabel) return null;
  return { minimumAge, maximumAge, classLabel };
}

export function calculateAge(dateOfBirth: Date, onDate = new Date()): number {
  let age = onDate.getFullYear() - dateOfBirth.getFullYear();
  const beforeBirthday = onDate.getMonth() < dateOfBirth.getMonth()
    || (onDate.getMonth() === dateOfBirth.getMonth() && onDate.getDate() < dateOfBirth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function matchesCompetitionAudience(input: {
  audienceLabel: string | null | undefined;
  className: string | null | undefined;
  dateOfBirth: Date | null | undefined;
  onDate?: Date;
}): boolean {
  const audience = parseCompetitionAudience(input.audienceLabel);
  if (!audience || !input.className || !input.dateOfBirth) return false;
  const normalizedAudienceClass = normalizeClassLabel(audience.classLabel);
  if (normalizedAudienceClass !== normalizeClassLabel(input.className)) return false;
  const age = calculateAge(input.dateOfBirth, input.onDate);
  return age >= audience.minimumAge && age <= audience.maximumAge;
}