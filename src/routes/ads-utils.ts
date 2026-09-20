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

export function getActivePlacementAds(placement: { campaigns?: Array<{ campaign: any }> } | null | undefined, now = new Date()) {
  if (!placement?.campaigns) return [];

  return placement.campaigns
    .map((entry) => entry.campaign)
    .filter((campaign) => {
      const withinDates = (!campaign.startDate || campaign.startDate <= now) && (!campaign.endDate || campaign.endDate >= now);
      return campaign.status === 'LIVE' && campaign.enabled && campaign.approvedAt && withinDates && campaign.advertiser?.verificationStatus === 'VERIFIED';
    })
    .filter((campaign) => campaign.landingUrl && isValidLandingUrl(campaign.landingUrl))
    .sort((a, b) => {
      const aOrder = a?.placements?.[0]?.sortOrder ?? 0;
      const bOrder = b?.placements?.[0]?.sortOrder ?? 0;
      return aOrder - bOrder || a.title.localeCompare(b.title);
    })
    .map((campaign) => {
      const primaryCreative = campaign.creatives?.[0] ?? null;
      return {
        id: campaign.id,
        title: campaign.title,
        headline: campaign.headline || primaryCreative?.headline || campaign.title,
        summary: campaign.summary || primaryCreative?.description || '',
        landingUrl: campaign.landingUrl,
        label: 'Sponsored',
        imageUrl: primaryCreative?.imageUrl || null,
        ctaText: primaryCreative?.ctaText || 'Learn more',
        description: primaryCreative?.description || campaign.summary || '',
        advertiser: campaign.advertiser?.companyName,
      };
    });
}

export function isValidLandingUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}
