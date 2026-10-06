export type ParentPortalQrStatus = { available: boolean; reason: string | null };

function configuredPublicAppUrl(environment: NodeJS.ProcessEnv) {
  const configuredUrl = environment.PUBLIC_APP_URL?.trim() || environment.FRONTEND_URL?.split(',')[0]?.trim();
  if (configuredUrl) return configuredUrl;
  return environment.NODE_ENV === 'production' ? 'https://www.schoolbase.live' : '';
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

export function getPublicAppOrigin(environment: NodeJS.ProcessEnv = process.env): string | null {
  if (!getParentPortalQrStatus(environment).available) return null;
  return new URL(configuredPublicAppUrl(environment)).origin;
}

export function buildParentPortalQrUrl(
  publicSchoolSlug: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const publicAppOrigin = getPublicAppOrigin(environment);
  if (!publicAppOrigin) return null;
  const url = new URL('/parent/login', publicAppOrigin);
  url.searchParams.set('schoolSlug', publicSchoolSlug);
  return url.toString();
}
