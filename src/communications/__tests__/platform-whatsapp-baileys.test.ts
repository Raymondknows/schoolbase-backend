import test from 'node:test';
import assert from 'node:assert/strict';
import { PlatformBaileysSessionManager } from '../platform-whatsapp-baileys.js';

test('platform Baileys sessions are isolated from school WhatsApp sessions', async () => {
  const manager = new PlatformBaileysSessionManager();
  const status = manager.getStatus();

  assert.equal(status.provider, 'BAILEYS');
  assert.equal(status.sessionNamespace, 'platform-admin');
  assert.equal(status.connected, false);
  assert.equal(status.health, 'not-configured');
});

test('platform sends use a dedicated outgoing namespace and keep platform state separate', async () => {
  const manager = new PlatformBaileysSessionManager();
  const session = (manager as any).getSession();
  (session as any).status = 'connected';
  (session as any).phoneNumber = '+2348000000000';
  (session as any).socket = {
    sendMessage: async (recipient: string, payload: { text: string }) => ({
      key: { id: `platform-${recipient}` },
      payload,
      recipient,
    }),
  };

  const result = await manager.sendTextMessage('+2348000000001', 'Platform test message');

  assert.equal(result.success, true);
  assert.equal(result.messageId?.startsWith('platform-'), true);
  assert.equal((manager as any).getSession().sessionNamespace, 'platform-admin');
});

test('platform Baileys exposes the same QR and pairing metadata used by the school connection flow', async () => {
  const manager = new PlatformBaileysSessionManager();
  const status = await manager.connect();

  assert.equal(status.status, 'connecting');
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'qr'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'pairingCode'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'pairingMethod'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'debugInfo'), true);
});

test('platform status service exposes QR and pairing metadata to the UI', async () => {
  const { platformWhatsAppService } = await import('../../services/platform-whatsapp.js');
  const snapshot = await platformWhatsAppService.getStatus();

  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'qr'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'pairingCode'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'pairingMethod'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'statusMessage'), true);
});

test('platform WhatsApp router exposes connect and disconnect handlers', async () => {
  const router = (await import('../../routes/platform-whatsapp.js')).default;
  const paths = router.stack.map((layer: any) => layer.route?.path).filter(Boolean);

  assert.ok(paths.includes('/connect'));
  assert.ok(paths.includes('/disconnect'));
  assert.ok(paths.includes('/status'));
});

test('platform WhatsApp service resolves school ids into valid recipient phone numbers', async () => {
  const { platformWhatsAppService } = await import('../../services/platform-whatsapp.js');
  const recipients = await platformWhatsAppService.resolveSchoolRecipients(
    ['school-1', 'school-2'],
    [
      { id: 'school-1', phone: '+2348000000001' },
      { id: 'school-2', phone: '+2348000000002' },
      { id: 'school-3', phone: '' },
    ],
  );

  assert.deepEqual(recipients, ['+2348000000001', '+2348000000002']);
});
