import test from 'node:test';
import assert from 'node:assert/strict';

import { hasFeeScheduleItemChanges } from '../src/routes/admin.js';

test('hasFeeScheduleItemChanges returns false when the fee list is unchanged', () => {
  const original = [
    { id: 'item-1', name: 'Tuition', amount: '100.00', description: '', isRequired: true, isNew: false },
  ];
  const current = [
    { id: 'item-1', name: 'Tuition', amount: '100.00', description: '', isRequired: true, isNew: false },
  ];

  assert.equal(hasFeeScheduleItemChanges(current, original), false);
});

test('hasFeeScheduleItemChanges returns true when a fee item is edited or added', () => {
  const original = [
    { id: 'item-1', name: 'Tuition', amount: '100.00', description: '', isRequired: true, isNew: false },
  ];
  const current = [
    { id: 'item-1', name: 'Tuition', amount: '150.00', description: '', isRequired: true, isNew: false },
  ];

  assert.equal(hasFeeScheduleItemChanges(current, original), true);
});
