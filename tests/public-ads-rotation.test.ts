import assert from 'node:assert/strict';
import { getActivePlacementAds } from '../src/routes/ads-utils.js';

const now = new Date('2026-06-01T00:00:00.000Z');

const campaigns = [
  {
    id: 'camp-1',
    title: 'Alpha',
    headline: 'Alpha head',
    summary: 'Alpha summary',
    landingUrl: 'https://example.com/a',
    status: 'LIVE',
    enabled: true,
    approvedAt: now,
    advertiser: { verificationStatus: 'VERIFIED', companyName: 'Alpha Co' },
    creatives: [{ imageUrl: 'https://example.com/a.png', headline: 'Alpha', description: 'Alpha summary', ctaText: 'Learn more' }],
  },
  {
    id: 'camp-2',
    title: 'Bravo',
    headline: 'Bravo head',
    summary: 'Bravo summary',
    landingUrl: 'https://example.com/b',
    status: 'LIVE',
    enabled: true,
    approvedAt: now,
    advertiser: { verificationStatus: 'VERIFIED', companyName: 'Bravo Co' },
    creatives: [{ imageUrl: 'https://example.com/b.png', headline: 'Bravo', description: 'Bravo summary', ctaText: 'See more' }],
  },
];

const placement = {
  id: 'place-1',
  label: 'Sponsored',
  campaigns: campaigns.map((campaign) => ({ campaign })),
};

const ads = getActivePlacementAds(placement as any, now);
assert.equal(ads.length, 2, 'all eligible ads for the placement should be returned');
assert.deepEqual(ads.map((ad) => ad.id), ['camp-1', 'camp-2']);
console.log('public ads rotation test passed');
