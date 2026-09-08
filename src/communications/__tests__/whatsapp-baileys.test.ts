import test from 'node:test';
import assert from 'node:assert/strict';
import { BaileysSessionManager } from '../whatsapp-baileys.js';

test('sendTextMessages handles multiple recipients and reports failures', async () => {
  const manager = new BaileysSessionManager();
  const schoolSession = (manager as any).getOrCreateSession('test-school-id');
  (schoolSession as any).status = 'connected';
  (schoolSession as any).phoneNumber = '2340000000000';
  (schoolSession as any).socket = {
    sendMessage: async (recipient: string, payload: { text: string }) => {
      if (recipient === '250793225342@s.whatsapp.net') {
        throw new Error('Failed to deliver to recipient');
      }
      return { status: 'sent', recipient, payload };
    },
  };

  const result = await manager.sendTextMessages('test-school-id', ['+250793225342', '+2349031368963'], 'Test message');

  assert.equal(result.success, false);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].recipient, '+250793225342');
  assert.equal(result.results[0].success, false);
  assert.ok(result.results[0].error?.includes('Failed to deliver'));
  assert.equal(result.results[1].recipient, '+2349031368963');
  assert.equal(result.results[1].success, true);
});

test('school sessions remain isolated when sending messages', async () => {
  const manager = new BaileysSessionManager();
  const schoolASession = (manager as any).getOrCreateSession('school-a');
  const schoolBSession = (manager as any).getOrCreateSession('school-b');
  const sentBySchool: string[] = [];

  for (const [schoolId, session] of [['school-a', schoolASession], ['school-b', schoolBSession]] as const) {
    (session as any).status = 'connected';
    (session as any).phoneNumber = `${schoolId}-phone`;
    (session as any).socket = {
      sendMessage: async () => {
        sentBySchool.push(schoolId);
        return { key: { id: `${schoolId}-message` } };
      },
    };
  }

  await manager.sendTextMessage('school-a', '+2348000000001', 'School A message');
  await manager.sendTextMessage('school-b', '+2348000000002', 'School B message');

  assert.deepEqual(sentBySchool, ['school-a', 'school-b']);
});

test('serializes concurrent sends within one school session', async () => {
  const previousInterval = process.env.WHATSAPP_MIN_SEND_INTERVAL_MS;
  process.env.WHATSAPP_MIN_SEND_INTERVAL_MS = '0';

  try {
    const manager = new BaileysSessionManager();
    const schoolSession = (manager as any).getOrCreateSession('paced-school');
    (schoolSession as any).status = 'connected';
    (schoolSession as any).phoneNumber = '2340000000000';

    let activeSends = 0;
    let maximumActiveSends = 0;
    (schoolSession as any).socket = {
      sendMessage: async () => {
        activeSends += 1;
        maximumActiveSends = Math.max(maximumActiveSends, activeSends);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeSends -= 1;
        return { key: { id: `message-${maximumActiveSends}` } };
      },
    };

    await Promise.all([
      manager.sendTextMessage('paced-school', '+2348000000001', 'First'),
      manager.sendTextMessage('paced-school', '+2348000000002', 'Second'),
    ]);

    assert.equal(maximumActiveSends, 1);
  } finally {
    if (previousInterval === undefined) delete process.env.WHATSAPP_MIN_SEND_INTERVAL_MS;
    else process.env.WHATSAPP_MIN_SEND_INTERVAL_MS = previousInterval;
  }
});
