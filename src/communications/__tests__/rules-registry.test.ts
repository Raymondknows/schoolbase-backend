import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationRulesRegistry } from '../rules.js';

test('keeps default communication rules enabled for core events', () => {
  const registry = new CommunicationRulesRegistry();
  const rules = registry.getRules('school-1');

  assert.equal(rules['FeeInvoiceCreated'].enabled, true);
  assert.equal(rules['AttendanceMarked'].enabled, true);
  assert.equal(rules['ResultsPublished'].enabled, true);
});

test('allows a school to disable and re-enable a specific event rule', () => {
  const registry = new CommunicationRulesRegistry();
  registry.setRuleEnabled('school-2', 'FeeInvoiceCreated', false);
  assert.equal(registry.getRules('school-2')['FeeInvoiceCreated'].enabled, false);

  registry.setRuleEnabled('school-2', 'FeeInvoiceCreated', true);
  assert.equal(registry.getRules('school-2')['FeeInvoiceCreated'].enabled, true);
});
