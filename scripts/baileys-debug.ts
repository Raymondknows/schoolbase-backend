import baileysSessionManager from '../src/communications/whatsapp-baileys.js';

async function main() {
  console.log('Starting Baileys debug probe...');
  const result = await baileysSessionManager.runDeepDebugProbe();
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error('Baileys debug probe failed:', error);
  process.exit(1);
});
