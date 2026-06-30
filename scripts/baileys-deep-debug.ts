import baileysSessionManager from '../src/communications/whatsapp-baileys.js';

async function main() {
  console.log('Starting deep Baileys diagnostic run...');
  const result = await baileysSessionManager.runDeepDebugProbe();
  console.log('Deep debug result:', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Deep Baileys debug failed:', error);
  process.exit(1);
});
