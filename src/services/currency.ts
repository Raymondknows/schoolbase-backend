export const SUPPORTED_COUNTRIES = ['NG', 'GH', 'SL', 'LR', 'GM'] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

export const COUNTRY_CURRENCY: Record<SupportedCountry, string> = {
  NG: 'NGN',
  GH: 'GHS',
  SL: 'SLE',
  LR: 'LRD',
  GM: 'GMD',
};

export function normalizeCurrency(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (Object.values(COUNTRY_CURRENCY).includes(normalized)) {
    return normalized;
  }
  return undefined;
}

export function getCurrencyForCountry(country: SupportedCountry): string {
  return COUNTRY_CURRENCY[country];
}

export function getDefaultCurrency(): string {
  return COUNTRY_CURRENCY.NG;
}

export function resolveSupportedCurrency(
  value?: string | null,
  fallbackCurrency?: string | null,
  ...additionalFallbacks: Array<string | null | undefined>
): string {
  const candidates = [value, fallbackCurrency, ...additionalFallbacks];

  for (const candidate of candidates) {
    const normalized = normalizeCurrency(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return getDefaultCurrency();
}
