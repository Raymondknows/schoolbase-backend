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

test('platform sends should succeed when the real Baileys manager reports the platform session as connected without a cached local socket', async () => {
  const { baileysSessionManager } = await import('../whatsapp-baileys.js');
  const sharedSession = (baileysSessionManager as any).getOrCreateSession('platform-admin');
  sharedSession.status = 'connected';
  sharedSession.phoneNumber = '+2348000000000';

  const manager = new PlatformBaileysSessionManager();
  const session = (manager as any).getSession();
  (session as any).status = 'disconnected';
  (session as any).phoneNumber = null;
  (session as any).socket = null;

  const original = baileysSessionManager.sendTextMessage;
  baileysSessionManager.sendTextMessage = async (schoolId: string, recipient: string, message: string) => {
    assert.equal(schoolId, 'platform-admin');
    assert.equal(recipient, '+2348000000001');
    assert.equal(message, 'Platform connected via shared manager');
    return { success: true, messageId: 'shared-manager-platform-message' };
  };

  try {
    const result = await manager.sendTextMessage('+2348000000001', 'Platform connected via shared manager');
    assert.equal(result.success, true);
    assert.equal(result.messageId, 'shared-manager-platform-message');
  } finally {
    baileysSessionManager.sendTextMessage = original;
  }
});

test('platform Baileys exposes the same QR and pairing metadata used by the school connection flow', async () => {
  const { baileysSessionManager } = await import('../whatsapp-baileys.js');
  await baileysSessionManager.disconnect('platform-admin');

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

test('platform campaign creation preserves the calculated audience size instead of defaulting to zero', async () => {
  const { platformWhatsAppService } = await import('../../services/platform-whatsapp.js');

  const campaign = await platformWhatsAppService.createCampaign({
    name: 'Audience count regression',
    audience: 'All schools',
    templateId: 'tpl-001',
    message: 'Test message',
    scheduled: 'Tomorrow',
    schoolCount: 25,
  });

  assert.equal(campaign.recipients, 25);
  assert.equal(campaign.audience, 'All schools');
});
