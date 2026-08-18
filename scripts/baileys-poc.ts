import fs from 'fs';
import path from 'path';

async function main() {
  const toNumberArg = process.env.TO_NUMBER || process.argv[2];
  if (!toNumberArg) {
    console.error('Usage: TO_NUMBER=2348012345678 npx tsx scripts/baileys-poc.ts');
    process.exit(1);
  }

  const toNumberDigits = toNumberArg.replace(/\D/g, '');
  const toJid = `${toNumberDigits}@s.whatsapp.net`;

  const authFolder = path.resolve(process.cwd(), '.baileys-poc-auth');
  if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

  console.log('[poc] Auth folder:', authFolder);

  let baileys: any;
  try {
    baileys = await import('@whiskeysockets/baileys');
    console.log('[poc] Imported @whiskeysockets/baileys');
  } catch (err) {
    console.error('[poc] Failed to import @whiskeysockets/baileys, trying legacy package', err);
    try {
      baileys = await import('@adiwajshing/baileys/lib/index.js');
      console.log('[poc] Imported legacy @adiwajshing/baileys');
    } catch (e) {
      console.error('[poc] Failed to import any baileys package', e);
      process.exit(1);
    }
  }

  const { makeWASocket, useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys;

  let version = [2, 3000, 1042373943];
  try {
    const meta = await fetchLatestWaWebVersion();
    if (meta?.version) version = meta.version;
  } catch (e) {
    console.warn('[poc] Failed to fetch latest WA web version, using fallback', e?.message || e);
  }
  console.log('[poc] Using WA version', version);

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  // Minimal pino-like logger wrapper so Baileys' `logger.child` works without
  // adding external deps. child() returns the same logger instance.
  function makeConsolePinoLogger() {
    const base: any = {
      child: () => base,
      trace: (...args: any[]) => console.trace('[baileys]', ...args),
      debug: (...args: any[]) => console.debug('[baileys]', ...args),
      info: (...args: any[]) => console.log('[baileys]', ...args),
      warn: (...args: any[]) => console.warn('[baileys]', ...args),
      error: (...args: any[]) => console.error('[baileys]', ...args),
    };
    return base;
  }

  const logger = makeConsolePinoLogger();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    browser: Browsers.macOS('Baileys-POC'),
    syncFullHistory: false,
    logger,
  });

  const lastQrFile = path.join(authFolder, 'last_qr.txt');

  sock.ev.on('creds.update', (creds: any) => {
    console.log('[poc] creds.update:', Object.keys(creds || {}));
    try { saveCreds(creds); } catch (e) { console.warn('[poc] saveCreds failed', e); }
  });

  sock.ev.on('connection.update', (update: any) => {
    try {
      console.log('[poc] connection.update', JSON.stringify(update));
    } catch (e) {
      console.log('[poc] connection.update (non-serializable)');
    }

    const { connection, qr, lastDisconnect } = update as any;

    if (qr) {
      const qrString = typeof qr === 'string' ? qr : JSON.stringify(qr);
      console.log('[poc] QR generated:', qrString);
      try { fs.writeFileSync(lastQrFile, qrString, 'utf8'); console.log('[poc] QR written to', lastQrFile); } catch (e) { console.warn('[poc] Failed to write QR', e); }
    }

    if (connection) console.log('[poc] connection state:', connection);
    if (lastDisconnect) console.log('[poc] lastDisconnect:', lastDisconnect);
  });

  sock.ev.on('messages.upsert', (m: any) => {
    console.log('[poc] messages.upsert', JSON.stringify(m));
  });

  sock.ev.on('contacts.update', (c: any) => {
    console.log('[poc] contacts.update', c);
  });

  sock.ev.on('chats.set', (c: any) => {
    console.log('[poc] chats.set', Object.keys(c || {}));
  });

  sock.ev.on('messages.delete', (m: any) => {
    console.log('[poc] messages.delete', m);
  });

  // wait for connection open
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn('[poc] Connection not established within 5 minutes; exiting');
      reject(new Error('connection timeout'));
    }, 1000 * 60 * 5);

    sock.ev.on('connection.update', (update: any) => {
      const { connection } = update as any;
      if (connection === 'open') {
        clearTimeout(timeout);
        console.log('[poc] connection open');
        resolve();
      }
    });
  }).catch((e) => {
    console.error('[poc] connection wait failed', e?.message || e);
    process.exit(1);
  });

  // send a test message
  try {
    console.log('[poc] Sending test message to', toJid);
    const res = await sock.sendMessage(toJid, { text: 'Hello from SchoolBase Test' });
    console.log('[poc] sendMessage result:', JSON.stringify(res));
  } catch (e) {
    console.error('[poc] sendMessage failed', e);
  }

  // keep process alive to listen for incoming messages
  console.log('[poc] POC is running — listening for incoming messages. Press Ctrl+C to exit.');

  process.on('SIGINT', async () => {
    console.log('[poc] SIGINT received — logging out and exiting');
    try { await sock.logout(); } catch (e) { console.warn('[poc] logout failed', e); }
    process.exit(0);
  });
}

main().catch((err) => { console.error('[poc] Fatal error', err); process.exit(1); });
