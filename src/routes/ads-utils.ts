export function normalizePlacementType(path: string): string {
  const normalized = String(path || '/').trim().toLowerCase();
  if (normalized === '/parent/login') return 'PARENT_LOGIN_BANNER';
  if (normalized === '/results/check' || normalized === '/result-checker') return 'RESULTS_CHECKER_SPONSOR';
  if (normalized === '/signup') return 'SIGNUP_PARTNER_STRIP';
  if (!normalized || normalized === '/' || normalized === '/login') return 'LOGIN_PAGE_BANNER';
  if (normalized.includes('blog') || normalized.includes('resource')) return 'RESOURCE_SPONSOR';
  if (normalized.includes('partner')) return 'PUBLIC_PARTNER_STRIP';
  return 'LOGIN_PAGE_BANNER';
}

export function isValidLandingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
