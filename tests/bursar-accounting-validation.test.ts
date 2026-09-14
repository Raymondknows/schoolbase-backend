import assert from 'node:assert/strict';
import { parseAmountMinor, parsePaymentMethod, parseTransactionDate } from '../src/routes/bursar.ts';

assert.equal(parseAmountMinor('2500.50'), 250050);
assert.equal(parseAmountMinor(0), null);
assert.equal(parseAmountMinor('-10'), null);
assert.equal(parseAmountMinor('not-a-number'), null);
assert.equal(parsePaymentMethod('CASH'), 'CASH');
assert.equal(parsePaymentMethod('MOBILE_MONEY'), undefined);
assert.ok(parseTransactionDate('2026-09-14'));
assert.equal(parseTransactionDate('invalid-date'), null);

console.log('bursar accounting validation test passed');
