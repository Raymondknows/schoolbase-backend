import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateIdCardQuote,
  DEFAULT_ID_CARD_PRICING_RULE,
  validateIdCardPricingRule,
} from '../src/services/id-card-pricing.ts';

describe('ID card pricing', () => {
  it('calculates the configured NGN 100 standard-card rate for one student', () => {
    const quote = calculateIdCardQuote({
      quantity: 1,
      templateId: 'modernInstitution',
      rule: DEFAULT_ID_CARD_PRICING_RULE,
    });

    assert.equal(quote.currency, 'NGN');
    assert.equal(quote.totalMinor, 10000);
  });

  it('uses marginal volume bands without repricing earlier cards', () => {
    const quote = calculateIdCardQuote({
      quantity: 50,
      templateId: 'crestClassic',
      rule: DEFAULT_ID_CARD_PRICING_RULE,
    });

    assert.equal(quote.baseAmountMinor, 49 * 10000 + 1 * 9000);
    assert.deepEqual(quote.bandBreakdown.map((band) => band.quantity), [49, 1]);
  });

  it('adds the disclosed premium uplift per card', () => {
    const quote = calculateIdCardQuote({
      quantity: 2,
      templateId: 'houseTeam',
      rule: DEFAULT_ID_CARD_PRICING_RULE,
    });

    assert.equal(quote.premiumAmountMinor, 8000);
    assert.equal(quote.totalMinor, 28000);
  });

  it('prices Signature Collection as a disclosed premium template', () => {
    const quote = calculateIdCardQuote({
      quantity: 2,
      templateId: 'signatureCollection',
      rule: DEFAULT_ID_CARD_PRICING_RULE,
    });

    assert.equal(quote.templateTier, 'PREMIUM');
    assert.equal(quote.upliftPerCardMinor, 4000);
    assert.equal(quote.totalMinor, 28000);
  });

  it('rejects invalid volume ranges, unknown templates, and oversized batches', () => {
    const invalidRule = {
      ...DEFAULT_ID_CARD_PRICING_RULE,
      volumeBands: [{ from: 2, through: null, unitPriceMinor: 10000 }],
    };

    assert.equal(validateIdCardPricingRule(invalidRule), false);
    assert.throws(() => calculateIdCardQuote({ quantity: 1, templateId: 'unknown', rule: DEFAULT_ID_CARD_PRICING_RULE }));
    assert.throws(() => calculateIdCardQuote({ quantity: 1001, templateId: 'modernInstitution', rule: DEFAULT_ID_CARD_PRICING_RULE }));
  });
});
