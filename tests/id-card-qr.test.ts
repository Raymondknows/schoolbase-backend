import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildParentPortalQrUrl, getParentPortalQrStatus } from '../src/services/id-card-qr.ts';

describe('Parent Portal ID card QR', () => {
  it('uses the canonical HTTPS app URL in production when no override is configured', () => {
    assert.equal(getParentPortalQrStatus({ NODE_ENV: 'production' }).available, true);
    assert.equal(buildParentPortalQrUrl('greenfield', { NODE_ENV: 'production' }), 'https://www.schoolbase.live/parent/login?schoolSlug=greenfield');
    assert.equal(getParentPortalQrStatus({ NODE_ENV: 'production', PUBLIC_APP_URL: 'http://schoolbase.live' }).available, false);
    assert.equal(getParentPortalQrStatus({ NODE_ENV: 'production', FRONTEND_URL: 'https://schoolbase.live' }).available, true);
  });

  it('uses the first frontend origin when multiple origins are configured', () => {
    const status = getParentPortalQrStatus({ NODE_ENV: 'production', FRONTEND_URL: 'https://www.schoolbase.live,https://admin.schoolbase.live' });
    assert.equal(status.available, true);
    assert.equal(buildParentPortalQrUrl('greenfield', { NODE_ENV: 'production', FRONTEND_URL: 'https://www.schoolbase.live,https://admin.schoolbase.live' }), 'https://www.schoolbase.live/parent/login?schoolSlug=greenfield');
  });

  it('encodes only the generic parent login path and the school public slug', () => {
    const environment = { NODE_ENV: 'production', PUBLIC_APP_URL: 'https://schoolbase.live/base' };
    const qrUrl = buildParentPortalQrUrl('greenfield-academy', environment);
    assert.ok(qrUrl);
    const parsed = new URL(qrUrl);
    assert.equal(parsed.pathname, '/parent/login');
    assert.equal(parsed.searchParams.get('schoolSlug'), 'greenfield-academy');
    assert.deepEqual(Array.from(parsed.searchParams.keys()), ['schoolSlug']);
    assert.equal(/[?&](student|pupil|guardian|admission|token|session|phone|email)=/i.test(qrUrl), false);
  });

  it('rejects credentials embedded in the public app URL', () => {
    const environment = { NODE_ENV: 'production', PUBLIC_APP_URL: 'https://user:secret@schoolbase.live' };
    assert.equal(getParentPortalQrStatus(environment).available, false);
    assert.equal(buildParentPortalQrUrl('greenfield-academy', environment), null);
  });
});
