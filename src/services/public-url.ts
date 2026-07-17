export function resolvePublicResultsUrl(value?: string | null): string {
  const fallback = 'https://schoolbase.live/results/check';

  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/\/$/, '');

  if (/^https?:\/\/localhost(?::\d+)?(\/|$)/i.test(normalized) || /^https?:\/\/127\.0\.0\.1(?::\d+)?(\/|$)/i.test(normalized)) {
    return fallback;
  }

  if (/^https?:\/\/[^/]+$/i.test(normalized)) {
    return `${normalized}/results/check`;
  }

  if (!normalized.includes('/results/check')) {
    return `${normalized}/results/check`;
  }

  return normalized;
}
