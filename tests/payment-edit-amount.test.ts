import test from 'node:test';
import assert from 'node:assert/strict';

import { recomputeInvoiceTotalsFromPayments } from '../src/routes/admin.js';

test('recomputeInvoiceTotalsFromPayments resets invoice paid amount correctly after a payment is edited down to zero', () => {
  const result = recomputeInvoiceTotalsFromPayments({
    amountDue: 50000,
    paymentAmounts: [50000],
    changedPaymentAmount: 0,
  });

  assert.equal(result.amountPaid, 0);
  assert.equal(result.status, 'SENT');
});

test('recomputeInvoiceTotalsFromPayments keeps the invoice paid when payments still cover the total due', () => {
  const result = recomputeInvoiceTotalsFromPayments({
    amountDue: 50000,
    paymentAmounts: [25000, 25000],
    changedPaymentAmount: 25000,
  });

  assert.equal(result.amountPaid, 50000);
  assert.equal(result.status, 'PAID');
});
