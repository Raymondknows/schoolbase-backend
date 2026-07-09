export const SUPPORTED_COUNTRIES = ['NG', 'GH', 'SL', 'LR', 'GM'] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

export const COUNTRY_CURRENCY: Record<SupportedCountry, string> = {
  NG: 'NGN',
  GH: 'GHS',
  SL: 'SLE',
  LR: 'LRD',
  GM: 'GMD',
};

export const COUNTRY_DETAILS: Record<SupportedCountry, { name: string; currency: string }> = {
  NG: { name: 'Nigeria', currency: COUNTRY_CURRENCY.NG },
  GH: { name: 'Ghana', currency: COUNTRY_CURRENCY.GH },
  SL: { name: 'Sierra Leone', currency: COUNTRY_CURRENCY.SL },
  LR: { name: 'Liberia', currency: COUNTRY_CURRENCY.LR },
  GM: { name: 'The Gambia', currency: COUNTRY_CURRENCY.GM },
};

export function normalizeCurrency(value?: string | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (Object.values(COUNTRY_CURRENCY).includes(normalized)) {
    return normalized;
  }
  return undefined;
}

export function resolveSupportedCurrency(value?: string | null, fallback?: string | null): string {
  return normalizeCurrency(value) || normalizeCurrency(fallback) || getDefaultCurrency();
}

export function getCurrencyForCountry(country: SupportedCountry): string {
  return COUNTRY_CURRENCY[country];
}

export function getDefaultCurrency(): string {
  return COUNTRY_CURRENCY.NG;
}
