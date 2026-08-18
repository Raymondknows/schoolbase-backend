import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransportConfig, buildSetupReminderTaskSections } from '../email.js';

test('buildTransportConfig respects SMTP_SECURE=false in production', () => {
  process.env.NODE_ENV = 'production';
  process.env.SMTP_SECURE = 'false';

  const config = buildTransportConfig();

  assert.equal(config.secure, false);
  assert.equal(config.port, 587);
});

test('buildTransportConfig defaults to secure=true when SMTP_SECURE is unset in production', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.SMTP_SECURE;

  const config = buildTransportConfig();

  assert.equal(config.secure, true);
});

test('buildSetupReminderTaskSections includes completed and missing setup items', () => {
  const sections = buildSetupReminderTaskSections(
    ['Enabled school phases', 'Academic years'],
    ['Classes', 'Subjects', 'Fee schedules'],
  );

  assert.match(sections.completedHtml, /Enabled school phases/);
  assert.match(sections.completedHtml, /Academic years/);
  assert.match(sections.missingHtml, /Classes/);
  assert.match(sections.missingHtml, /Subjects/);
  assert.match(sections.missingHtml, /Fee schedules/);
});
