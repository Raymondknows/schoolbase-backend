export type SecurityContextInput = {
  authenticatedSchoolId?: string | null;
  authenticatedRole?: string | null;
  requestedSchoolId?: string | null;
};

export type SecurityContextResult = {
  schoolId: string | null;
  rejected: boolean;
  reason?: string;
};

/**
 * Resolve tenant scope without allowing school users to switch schools through
 * query parameters, headers, or request bodies.
 */
export function resolveSchoolScope(input: SecurityContextInput): SecurityContextResult {
  const authenticatedSchoolId = normalize(input.authenticatedSchoolId);
  const requestedSchoolId = normalize(input.requestedSchoolId);
  const role = normalize(input.authenticatedRole)?.toUpperCase() ?? null;

  if (authenticatedSchoolId) {
    if (requestedSchoolId && requestedSchoolId !== authenticatedSchoolId && role !== 'PLATFORM_ADMIN') {
      return {
        schoolId: null,
        rejected: true,
        reason: 'Requested school does not match the authenticated school',
      };
    }

    return { schoolId: role === 'PLATFORM_ADMIN' && requestedSchoolId ? requestedSchoolId : authenticatedSchoolId, rejected: false };
  }

  if (role === 'PLATFORM_ADMIN' && requestedSchoolId) {
    return { schoolId: requestedSchoolId, rejected: false };
  }

  return { schoolId: null, rejected: false };
}

function normalize(value?: string | null): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}
