import test from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationService, RulesEngine, TemplateEngine, RecipientResolver, DeliveryQueue, DriverManager, EmailDriver } from '../index.js';

test('dispatches a notification through the communication engine', async () => {
  const emailDriver = new EmailDriver(async () => ({
    channel: 'EMAIL',
    recipient: 'guardian@example.com',
    status: 'QUEUED',
    provider: 'email-test',
  }));

  const service = new CommunicationService({
    rulesEngine: new RulesEngine(),
    templateEngine: new TemplateEngine(),
    recipientResolver: new RecipientResolver(),
    deliveryQueue: new DeliveryQueue(async () => ({
      channel: 'EMAIL',
      recipient: 'guardian@example.com',
      status: 'QUEUED',
      provider: 'email-test',
    })),
    driverManager: new DriverManager({ EMAIL: emailDriver }),
  });

  const result = await service.dispatch({
    event: 'FeeInvoiceCreated',
    schoolId: 'school-1',
    recipients: [
      {
        channel: 'EMAIL',
        address: 'guardian@example.com',
        name: 'Ada',
      },
    ],
    template: 'FeeReminder',
    data: {
      studentName: 'Amara',
      schoolName: 'Bright Stars',
      amount: '5000',
      balance: '5000',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.deliveries.length, 1);
  assert.equal(result.deliveries[0]?.channel, 'EMAIL');
});

test('treats PIN delivery notifications as multi-channel communication', () => {
  const rulesEngine = new RulesEngine();
  const ruleSet = rulesEngine.evaluate('PinDelivered', 'school-1');

  assert.equal(ruleSet.template, 'Results');
  assert.deepEqual(ruleSet.channels, ['EMAIL', 'WHATSAPP']);
});

test('delivery queue schedules retries for failed sends', async () => {
  const failedSend = async () => ({
    channel: 'WHATSAPP' as const,
    recipient: '+2347000000000',
    status: 'FAILED' as const,
    provider: 'wa-test',
    error: 'network error',
  });

  const deliveryQueue = new DeliveryQueue(failedSend);

  const outcome = await deliveryQueue.enqueue(
    {
      event: 'FeeInvoiceCreated',
      schoolId: 'school-1',
      data: { studentName: 'Amara' },
    },
    { channel: 'WHATSAPP', address: '+2347000000000', name: 'Ada' },
    { subject: 'Retry test', body: 'This is a retry test.' }
  );

  assert.equal(outcome.status, 'FAILED');
  assert.equal(deliveryQueue.getQueueSummary().pendingCount, 1);
  assert.ok(deliveryQueue.getQueueSummary().nextRunAt);
});
