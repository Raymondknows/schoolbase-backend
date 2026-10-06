export type ParentPortalQrStatus = { available: boolean; reason: string | null };

function configuredPublicAppUrl(environment: NodeJS.ProcessEnv) {
  return environment.PUBLIC_APP_URL?.trim() || environment.FRONTEND_URL?.trim() || '';
}

export function getParentPortalQrStatus(environment: NodeJS.ProcessEnv = process.env): ParentPortalQrStatus {
  const publicAppUrl = configuredPublicAppUrl(environment);
  if (!publicAppUrl) {
    return { available: false, reason: 'Set PUBLIC_APP_URL or FRONTEND_URL before generating a Parent Portal QR.' };
  }

  try {
    const parsed = new URL(publicAppUrl);
    if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol) || (environment.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
      return { available: false, reason: 'The public app URL must be a secure HTTPS origin.' };
    }
    return { available: true, reason: null };
  } catch {
    return { available: false, reason: 'The configured public app URL is invalid.' };
  }
}

export function buildParentPortalQrUrl(
  publicSchoolSlug: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!getParentPortalQrStatus(environment).available) return null;
  const url = new URL('/parent/login', configuredPublicAppUrl(environment));
  url.searchParams.set('schoolSlug', publicSchoolSlug);
  return url.toString();
}
