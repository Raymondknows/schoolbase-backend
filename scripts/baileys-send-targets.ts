import baileysSessionManager from '../src/communications/whatsapp-baileys.js';
import readline from 'readline';

// CLI-friendly, production-safe test sender.
// Usage: DEV_SCHOOL_ID=<id> node backend/scripts/baileys-send-targets.js --school-id <id> --confirm

const targetsDefault = ['+250793225342', '+2349031368963'];
const messageDefault = 'SchoolBase verification message: this is a test send via Baileys.';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--school-id' && args[i + 1]) {
      out.schoolId = String(args[++i]);
    } else if (a === '--confirm') {
      out.confirm = true;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--message' && args[i + 1]) {
      out.message = String(args[++i]);
    } else if (a === '--targets' && args[i + 1]) {
      out.targets = String(args[++i]);
    }
  }
  return out;
}

async function confirmPrompt(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer).toLowerCase().startsWith('y'));
    });
  });
}

async function main() {
  const args = parseArgs();
  const schoolId = (args.schoolId as string) || process.env.DEV_SCHOOL_ID;
  const confirmFlag = Boolean(args.confirm) || process.env.FORCE_SEND === 'true';
  const dryRun = Boolean(args.dryRun);
  const message = (args.message as string) || messageDefault;
  const targets = args.targets ? (String(args.targets).split(',').map((t) => t.trim()).filter(Boolean)) : targetsDefault;

  if (!schoolId) {
    console.error('Error: schoolId must be provided via --school-id or DEV_SCHOOL_ID env var');
    process.exit(2);
  }

  if (!confirmFlag && process.env.NODE_ENV === 'production') {
    console.error('Refusing to run in production without explicit confirmation. Use --confirm or set FORCE_SEND=true');
    process.exit(2);
  }

  if (!confirmFlag) {
    // Ask interactively
    const ok = await confirmPrompt(`Send message to ${targets.length} recipients for school ${schoolId}? (y/N) `);
    if (!ok) {
      console.log('Aborted by user');
      process.exit(0);
    }
  }

  console.log('Using schoolId:', schoolId);
  console.log('Targets:', targets);
  console.log('Message:', message);

  if (dryRun) {
    console.log('Dry-run mode; not sending');
    process.exit(0);
  }

  let status = baileysSessionManager.getStatus(schoolId);
  if (status.status !== 'connected') {
    console.log('Session not connected; attempting to reconnect using persisted auth...');
    try {
      await baileysSessionManager.connect(schoolId);
    } catch (e) {
      console.error('Reconnect attempt failed:', e);
    }

    // Wait up to 30s for connected state
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      status = baileysSessionManager.getStatus(schoolId);
      if (status.status === 'connected') break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  status = baileysSessionManager.getStatus(schoolId);
  if (status.status !== 'connected') {
    console.error('Baileys session failed to connect within timeout. Current status:', status.status, status.statusMessage);
    process.exit(1);
  }

  console.log('Sending test message to targets:', targets);
  const result = await baileysSessionManager.sendTextMessages(schoolId, targets, message);
  console.log('Send result:', JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error('Failed to send WhatsApp test messages:', error);
  process.exit(1);
});
