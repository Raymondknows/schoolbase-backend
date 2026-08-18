import test from 'node:test';
import assert from 'node:assert/strict';
import { BaileysSessionManager } from '../whatsapp-baileys.js';

test('sendTextMessages handles multiple recipients and reports failures', async () => {
  const manager = new BaileysSessionManager();
  (manager as any).status = 'connected';
  (manager as any).phoneNumber = '2340000000000';
  (manager as any).socket = {
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
