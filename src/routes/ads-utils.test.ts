import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidLandingUrl, normalizePlacementType } from './ads-utils.js';

test('routes public pages to the correct audience placement', () => {
  assert.equal(normalizePlacementType('/login'), 'LOGIN_PAGE_BANNER');
  assert.equal(normalizePlacementType('/parent/login'), 'PARENT_LOGIN_BANNER');
  assert.equal(normalizePlacementType('/results/check'), 'RESULTS_CHECKER_SPONSOR');
  assert.equal(normalizePlacementType('/result-checker'), 'RESULTS_CHECKER_SPONSOR');
  assert.equal(normalizePlacementType('/signup'), 'SIGNUP_PARTNER_STRIP');
  assert.equal(normalizePlacementType('/blog/term-planning'), 'RESOURCE_SPONSOR');
});

test('accepts only http and https advertiser landing URLs', () => {
  assert.equal(isValidLandingUrl('https://schoolbase.live/partners'), true);
  assert.equal(isValidLandingUrl('http://example.com'), true);
  assert.equal(isValidLandingUrl('javascript:alert(1)'), false);
  assert.equal(isValidLandingUrl('not-a-url'), false);
});