import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGuardianNotificationTargets } from '../guardian-notification-recipients.js';

test('resolveGuardianNotificationTargets filters to selected guardians and skips empty contacts', () => {
  const targets = resolveGuardianNotificationTargets(
    [
      {
        guardian: {
          id: 'g1',
          firstName: 'Ada',
          lastName: 'Okafor',
          email: 'ada@example.com',
          whatsapp: '+2348000000001',
          phone: '+2348000000001',
        },
      },
      {
        guardian: {
          id: 'g2',
          firstName: 'John',
          lastName: 'Okafor',
          email: null,
          whatsapp: null,
          phone: null,
        },
      },
      {
        guardian: {
          id: 'g3',
          firstName: 'Bola',
          lastName: 'Okafor',
          email: 'bola@example.com',
          whatsapp: null,
          phone: '+2348000000002',
        },
      },
    ],
    ['g1', 'g3'],
  );

  assert.equal(targets.length, 2);
  assert.equal(targets[0].guardian.id, 'g1');
  assert.deepEqual(
    targets[0].recipients.map((recipient) => recipient.channel),
    ['EMAIL', 'WHATSAPP'],
  );
  assert.equal(targets[1].guardian.id, 'g3');
  assert.equal(targets[1].recipients.length, 2);
});

test('resolveGuardianNotificationTargets ignores blank and whitespace-only contact values', () => {
  const targets = resolveGuardianNotificationTargets(
    [
      {
        guardian: {
          id: 'g1',
          firstName: 'Ada',
          lastName: 'Okafor',
          email: '   ',
          whatsapp: '   ',
          phone: '   ',
        },
      },
      {
        guardian: {
          id: 'g2',
          firstName: 'John',
          lastName: 'Okafor',
          email: 'john@example.com',
          whatsapp: '   ',
          phone: null,
        },
      },
    ],
    ['g1', 'g2'],
  );

  assert.equal(targets.length, 1);
  assert.equal(targets[0].guardian.id, 'g2');
  assert.deepEqual(
    targets[0].recipients.map((recipient) => recipient.channel),
    ['EMAIL'],
  );
  assert.equal(targets[0].recipients[0].address, 'john@example.com');
});
