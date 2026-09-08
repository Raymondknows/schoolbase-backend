import test from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppDeliveryWorker } from '../whatsapp-delivery-worker.js';
import { SchoolWhatsAppRateLimiter } from '../whatsapp-rate-limiter.js';

test('delivery worker only processes pending jobs for the selected school', async () => {
  const records = [
    { id: 'a1', schoolId: 'school-a', status: 'QUEUED', nextAttemptAt: new Date(), recipientAddress: '+2348000000001', messagePreview: 'Hello A', attemptCount: 0 },
    { id: 'a2', schoolId: 'school-a', status: 'QUEUED', nextAttemptAt: new Date(), recipientAddress: '+2348000000002', messagePreview: 'Hello A2', attemptCount: 0 },
    { id: 'b1', schoolId: 'school-b', status: 'QUEUED', nextAttemptAt: new Date(), recipientAddress: '+2348000000003', messagePreview: 'Hello B', attemptCount: 0 },
  ];

  const prisma = {
    whatsAppDelivery: {
      findMany: async ({ where }: any) => {
        const schoolId = where?.schoolId;
        return records.filter((record) => record.schoolId === schoolId && record.status === 'QUEUED');
      },
      update: async ({ where, data }: any) => {
        const target = records.find((record) => record.id === where.id);
        if (!target) {
          throw new Error(`Delivery ${where.id} not found`);
        }

        Object.assign(target, data);
        return { ...target };
      },
    },
  } as any;

  const processed: string[] = [];
  const worker = new WhatsAppDeliveryWorker(prisma, new SchoolWhatsAppRateLimiter({ minIntervalMs: 0, perMinuteLimit: 20, perHourLimit: 50, perDayLimit: 200 }));

  const result = await worker.processSchoolQueue('school-a', async (delivery) => {
    processed.push(delivery.id);
    return { success: true, providerMessageId: `msg-${delivery.id}` };
  });

  assert.equal(result.processed, 2);
  assert.deepEqual(processed, ['a1', 'a2']);
  assert.equal(result.skipped, 0);
});
