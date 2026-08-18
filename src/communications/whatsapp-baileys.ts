import * as dns from 'dns';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type BaileysSessionStatus = 'idle' | 'connecting' | 'qr' | 'connected' | 'disconnected' | 'error';

export interface BaileysSessionSnapshot {
  status: BaileysSessionStatus;
  statusMessage: string;
  qr?: string;
  phoneNumber?: string;
  pairingCode?: string;
  pairingMethod?: string;
  lastError?: string;
  debugLog?: string[];
  debugInfo?: Record<string, unknown>;
}

export interface BaileysDebugProbeResult {
  ok: boolean;
  summary: string;
  events: string[];
  timeline?: string[];
  durationMs: number;
  authFolder: string;
  version: number[];
  error?: string;
  environment?: Record<string, unknown>;
  packageInfo?: Record<string, unknown>;
  authSnapshot?: Record<string, unknown>;
}

const sessionDirectory = path.resolve(process.cwd(), '.baileys-session');
if (!fs.existsSync(sessionDirectory)) {
  fs.mkdirSync(sessionDirectory, { recursive: true });
}

function normalizeWhatsappRecipient(value?: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.includes('@')) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function makeConsolePinoLogger(): any {
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

export function shouldResetAuthStateForConnection(
  previousStatus?: BaileysSessionStatus | string,
  usePairingCode = false,
  lastError?: string,
): boolean {
  const normalizedStatus = String(previousStatus ?? '').toLowerCase();
  const normalizedError = String(lastError ?? '').toLowerCase();

  if (usePairingCode) return true;
  if (normalizedStatus === 'error') return true;
  if (normalizedStatus === 'disconnected') return true;

  if (normalizedStatus === 'connecting' && /(connection failure|forbidden|session expired|logged out|unauthorized|401|403|440)/i.test(normalizedError)) {
    return true;
  }

  return false;
}

class BaileysSchoolSession {
  private status: BaileysSessionStatus = 'disconnected';
  private statusMessage = 'Disconnected';
  private qr?: string;
  private phoneNumber?: string;
  private pairingCode?: string;
  private pairingMethod?: string;
  private pairingPhoneNumber?: string;
  private pairingMode: 'qr' | 'code' = 'qr';
  private pairingCodeRequested = false;
  private pairingReconnectAttempts = 0;
  private pairingReconnectPending = false;
  private streamErrorReconnectAttempts = 0;
  private streamErrorReconnectPending = false;
  private lastError?: string;
  private connectingPromise: Promise<void> | null = null;
  private socket: any = null;
  private debugLog: string[] = [];
  private debugInfo: Record<string, unknown> = {};
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private schoolId: string;

  constructor(schoolId: string) {
    this.schoolId = schoolId;
  }

  private safeStringify(value: unknown): string {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private appendDebug(message: string, detail?: unknown): void {
    const formattedDetail = detail === undefined ? '' : ` | ${this.safeStringify(detail)}`;
    const entry = `${new Date().toISOString()} ${message}${formattedDetail}`;
    this.debugLog.push(entry);
    if (this.debugLog.length > 120) {
      this.debugLog.shift();
    }
    console.log(`[baileys-debug] ${entry}`);
  }

  private updateDebugInfo(updater: (info: Record<string, unknown>) => void): void {
    updater(this.debugInfo);
  }

  private normalizePairingPhoneNumber(value?: string): string {
    const digits = (value ?? '').replace(/\D/g, '');
    return digits;
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    // Send a keep-alive presence update every 25 seconds to maintain the connection
    this.keepaliveTimer = setInterval(() => {
      if (this.socket && this.status === 'connected') {
        try {
          if (this.socket.sendPresenceUpdate) {
            this.socket.sendPresenceUpdate('available');
          }
        } catch (error) {
          console.warn('[baileys-keepalive] Failed to send keep-alive:', error);
        }
      }
    }, 25000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  getStatus(): BaileysSessionSnapshot {
    return {
      status: this.status,
      statusMessage: this.statusMessage,
      qr: this.qr,
      phoneNumber: this.phoneNumber,
      pairingCode: this.pairingCode,
      pairingMethod: this.pairingMethod,
      lastError: this.lastError,
      debugLog: [...this.debugLog],
      debugInfo: { ...this.debugInfo },
    };
  }

  async connect(pairingPhoneNumber?: string, usePairingCode = false): Promise<BaileysSessionSnapshot> {
    if (this.status === 'connected') {
      return this.getStatus();
    }

    if (this.connectingPromise) {
      await this.connectingPromise;
      return this.getStatus();
    }

    const shouldResetAuthState = shouldResetAuthStateForConnection(this.status, usePairingCode, this.lastError);

    this.debugLog = [];
    this.debugInfo = {};
    this.status = 'connecting';
    this.statusMessage = 'Starting SchoolBase connection…';
    this.qr = undefined;
    this.pairingCode = undefined;
    this.pairingMethod = undefined;
    this.pairingMode = usePairingCode ? 'code' : 'qr';
    this.pairingPhoneNumber = this.normalizePairingPhoneNumber(pairingPhoneNumber) || undefined;
    this.pairingCodeRequested = Boolean(usePairingCode);
    this.pairingReconnectAttempts = 0;
    this.pairingReconnectPending = false;
    this.lastError = undefined;
    this.appendDebug('connect() requested', {
      pairingPhoneNumber: this.pairingPhoneNumber || null,
      pairingMode: this.pairingMode,
      pairingCodeRequested: Boolean(usePairingCode),
      shouldResetAuthState,
    });

    if (this.socket?.end || this.socket?.logout) {
      try {
        if (this.socket.logout) {
          await this.socket.logout();
        } else if (this.socket.end) {
          this.socket.end();
        }
      } catch (error) {
        console.warn('[baileys] cleanup of prior socket failed', error);
      }
      this.socket = null;
    }

    this.connectingPromise = this.doConnect(shouldResetAuthState);
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }

    return this.getStatus();
  }

  async disconnect(): Promise<BaileysSessionSnapshot> {
    this.stopKeepalive();
    try {
      if (this.socket?.logout) {
        await this.socket.logout();
      } else if (this.socket?.end) {
        this.socket.end();
      }
    } catch (error) {
      console.warn('[baileys] disconnect error:', error);
    }
    this.socket = null;
    this.status = 'disconnected';
    this.statusMessage = 'Disconnected';
    this.qr = undefined;
    this.phoneNumber = undefined;
    this.pairingCode = undefined;
    this.pairingMethod = undefined;
    this.pairingCodeRequested = false;
    this.lastError = undefined;
    return this.getStatus();
  }

  async sendTextMessage(recipient: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const normalizedRecipient = normalizeWhatsappRecipient(recipient);
    if (!normalizedRecipient) {
      return { success: false, error: 'Invalid recipient phone number' };
    }

    const attemptSend = async (attempt = 0): Promise<{ success: boolean; messageId?: string; error?: string }> => {
      if (!this.phoneNumber || this.status !== 'connected' || !this.socket) {
        if (attempt === 0) {
          this.appendDebug('WhatsApp session not ready, attempting reconnect', { recipient: normalizedRecipient });
          try {
            await this.connect();
          } catch (connectError) {
            const errorMessage = connectError instanceof Error ? connectError.message : String(connectError);
            this.lastError = errorMessage;
            this.appendDebug('reconnect failed', { recipient: normalizedRecipient, error: errorMessage });
            return { success: false, error: errorMessage };
          }
          return attemptSend(1);
        }
        return { success: false, error: 'WhatsApp is not connected or phone device not synced' };
      }

      try {
        this.appendDebug('sending message', { to: normalizedRecipient, body: message });
        const res = await this.socket.sendMessage(normalizedRecipient, { text: message });
        this.appendDebug('send result', { to: normalizedRecipient, res });
        const messageId = res?.key?.id ? String(res.key.id) : undefined;
        return { success: true, messageId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.lastError = errorMessage;
        this.appendDebug('send failed', { to: normalizedRecipient, error: errorMessage });
        if (attempt === 0) {
          this.appendDebug('retrying send after transient failure', { recipient: normalizedRecipient, attempt: 1 });
          try {
            await this.connect();
          } catch (connectError) {
            const reconnectError = connectError instanceof Error ? connectError.message : String(connectError);
            this.appendDebug('retry reconnect failed', { recipient: normalizedRecipient, error: reconnectError });
          }
          return attemptSend(1);
        }
        return { success: false, error: errorMessage };
      }
    };

    return attemptSend();
  }

  async sendTextMessages(recipients: string | string[], message: string): Promise<{ success: boolean; results: Array<{ recipient: string; success: boolean; error?: string }> }> {
    const recipientList = Array.isArray(recipients) ? recipients : [recipients];
    const results: Array<{ recipient: string; success: boolean; error?: string }> = [];

    for (const recipient of recipientList) {
      const result = await this.sendTextMessage(recipient, message);
      results.push({ recipient, ...result });
    }

    return { success: results.every((r) => r.success), results };
  }

  private async doConnect(resetAuthState = true): Promise<void> {
    try {
  this.status = 'connecting';
    this.statusMessage = 'Starting SchoolBase connection…';
      this.qr = undefined;
      this.pairingCode = undefined;
      this.pairingMethod = undefined;
      this.lastError = undefined;

      let baileys: any;
      let makeWASocket: any;
      let useMultiFileAuthState: any;
      let Browsers: any;
      let fetchLatestWaWebVersion: any;

      try {
        baileys = await import('@whiskeysockets/baileys');
        makeWASocket = baileys.makeWASocket ?? baileys.default?.default;
        ({ useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys);
        this.appendDebug('Using maintained Baileys package', { package: '@whiskeysockets/baileys' });
      } catch (error) {
        baileys = await import('@adiwajshing/baileys/lib/index.js');
        const socketModule: any = await import('@adiwajshing/baileys/lib/Socket/index.js');
        makeWASocket = socketModule?.default?.default ?? socketModule?.default ?? socketModule;
        ({ useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys);
        this.appendDebug('Fell back to legacy Baileys package', { package: '@adiwajshing/baileys' });
      }

      let version = [2, 3000, 1015901308];
      try {
        const versionMeta = await fetchLatestWaWebVersion();
        if (versionMeta?.version && Array.isArray(versionMeta.version)) {
          version = versionMeta.version;
        }
      } catch (error) {
        console.warn('[baileys] failed to fetch latest WA version, using default', error);
      }
      this.appendDebug('Baileys connection attempt started', { version });
      console.log('[baileys] using WA version', version);

      const authFolder = path.join(sessionDirectory, this.schoolId, 'auth_info');
      this.appendDebug('Using auth folder', authFolder);

      if (resetAuthState && fs.existsSync(authFolder)) {
        this.appendDebug('Resetting existing Baileys auth state before connecting', { authFolder });
        fs.rmSync(authFolder, { recursive: true, force: true });
      } else if (!resetAuthState) {
        this.appendDebug('Reusing existing Baileys auth state for pairing retry', { authFolder });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authFolder);

      const logger = makeConsolePinoLogger();
      const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        browser: Browsers.macOS('SchoolBase'),
        syncFullHistory: false,
        logger,
      });

      this.socket = sock;
      this.appendDebug('Pairing mode selected', { activeMode: this.pairingMode });
      this.updateDebugInfo((info) => {
        info.socketCreated = true;
        info.authFolder = authFolder;
        info.version = version;
        info.streamErrorRetrying = false;
        info.streamErrorReconnectAttempts = 0;
      });
      this.appendDebug('Socket created, attaching event handlers', { version });
      console.log('[baileys] socket created, attaching event handlers');

      sock.ev.on('creds.update', (credsUpdate: any) => {
        try {
          console.log('[baileys] creds.update event', Object.keys(credsUpdate || {}));
        } catch (e) {
          console.warn('[baileys] creds.update logging failed', e);
        }
        this.appendDebug('creds.update emitted', { keys: Object.keys(credsUpdate || {}) });
        try {
          saveCreds(credsUpdate);
        } catch (e) {
          console.warn('[baileys] saveCreds failed', e);
        }
      });

      sock.ev.on('connection.update', (update: any) => {
        try {
          console.log('[baileys] connection.update', JSON.stringify(update));
        } catch (e) {
          console.log('[baileys] connection.update (non-serializable)');
        }

        try {
          const { connection, lastDisconnect, qr } = update as any;
          this.appendDebug('connection.update received', {
            connection,
            hasQr: Boolean(qr),
            statusCode: lastDisconnect?.error?.output?.statusCode,
            errorMessage: lastDisconnect?.error?.message,
          });
          this.updateDebugInfo((info) => {
            info.lastConnectionUpdate = {
              connection,
              hasQr: Boolean(qr),
              statusCode: lastDisconnect?.error?.output?.statusCode,
              errorMessage: lastDisconnect?.error?.message,
            };
          });

          if (qr) {
            this.status = 'qr';
            this.statusMessage = 'Scan the QR code to connect';
            this.qr = typeof qr === 'string' ? qr : JSON.stringify(qr);
            this.lastError = undefined;
            this.appendDebug('QR received', { length: this.qr ? String(this.qr).length : 0, preview: String(this.qr).slice(0, 80) });
            console.log('[baileys] QR received (length):', this.qr ? String(this.qr).length : 0);
            try {
              const qrFile = path.join(sessionDirectory, 'last_qr.txt');
              fs.writeFileSync(qrFile, this.qr || '', { encoding: 'utf8' });
              console.log('[baileys] Wrote QR to', qrFile);
            } catch (e) {
              console.warn('[baileys] Failed to write QR file', e);
            }
          }

          if (connection === 'open') {
            this.status = 'connected';
            this.statusMessage = 'WhatsApp connected';
            this.pairingMethod = 'connected';
            this.qr = undefined;
            this.lastError = undefined;
            this.phoneNumber = sock.user?.id || undefined;
            this.streamErrorReconnectAttempts = 0;
            this.streamErrorReconnectPending = false;
            this.updateDebugInfo((info) => {
              info.streamErrorRetrying = false;
              info.streamErrorReconnectAttempts = 0;
            });
            this.appendDebug('connection open', { phoneNumber: this.phoneNumber });
            console.log('[baileys] connection open, phone:', this.phoneNumber);
            if (this.pairingMode === 'code' && this.pairingPhoneNumber) {
              void this.requestPairingCodeAfterHandshake(sock, this.pairingPhoneNumber);
            }
            this.startKeepalive();
          }

          if (connection === 'close') {
            this.stopKeepalive();
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const errorMessage = lastDisconnect?.error?.message || 'Connection closed';
            this.appendDebug('connection closed', { statusCode, error: errorMessage });
            console.log('[baileys] connection closed, statusCode:', statusCode, 'error:', errorMessage);

            if (this.qr && statusCode === 515 && !this.streamErrorReconnectPending && this.streamErrorReconnectAttempts < 2) {
              this.status = 'qr';
              this.statusMessage = 'Stream error detected. Retrying connection to complete pairing...';
              this.lastError = undefined;
              this.appendDebug('Scheduling reconnect after stream error close', { statusCode, errorMessage });
              this.streamErrorReconnectPending = true;
              this.streamErrorReconnectAttempts += 1;
              this.socket = null;
              this.updateDebugInfo((info) => {
                info.streamErrorRetrying = true;
                info.streamErrorReconnectAttempts = this.streamErrorReconnectAttempts;
              });

              setTimeout(async () => {
                this.streamErrorReconnectPending = false;
                if (!this.connectingPromise && this.status !== 'connected') {
                  this.appendDebug('Retrying Baileys connection after stream error', { attempt: this.streamErrorReconnectAttempts });
                  this.connectingPromise = this.doConnect(false);
                  try {
                    await this.connectingPromise;
                  } finally {
                    this.connectingPromise = null;
                  }
                }
              }, 1500);

              return;
            }

            if (this.qr && statusCode !== 401 && statusCode !== 440 && !String(errorMessage).toLowerCase().includes('logged out')) {
              this.status = 'qr';
              this.statusMessage = 'QR is ready. Scan it with WhatsApp or reconnect if it expires.';
              this.lastError = undefined;
              this.appendDebug('Preserving QR after close event', { statusCode, errorMessage });
              return;
            }

            const shouldClearAuthState = statusCode === 401 || statusCode === 403 || statusCode === 440 || /connection failure|forbidden|logged out|session expired|unauthorized/i.test(String(errorMessage).toLowerCase());
            if (shouldClearAuthState) {
              this.status = 'error';
              this.statusMessage = 'WhatsApp connection failed. Please try again to start a fresh session.';
              this.lastError = errorMessage || 'Connection Failure';
              try {
                const schoolAuthFolder = path.join(sessionDirectory, this.schoolId, 'auth_info');
                fs.rmSync(schoolAuthFolder, { recursive: true, force: true });
                this.appendDebug('Cleared stale auth state after failed close', { authFolder: schoolAuthFolder, statusCode, errorMessage });
              } catch (cleanupError) {
                this.appendDebug('Failed to clear stale auth state', cleanupError);
              }
            } else {
              this.status = 'error';
              this.statusMessage = errorMessage || 'WhatsApp disconnected';
              this.lastError = errorMessage;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[baileys] Error in connection.update handler:', error);
          this.status = 'error';
          this.statusMessage = errorMessage || 'Failed to process connection update';
          this.lastError = errorMessage;
        }
      });

      sock.ev.on('messages.upsert', (messages: any) => {
        this.appendDebug('messages.upsert received', { count: Array.isArray(messages) ? messages.length : 1 });
      });

      sock.ev.on('contacts.update', (contacts: any) => {
        this.appendDebug('contacts.update received', { count: Array.isArray(contacts) ? contacts.length : 1 });
      });

      sock.ev.on('chats.set', (chats: any) => {
        this.appendDebug('chats.set received', { keys: Object.keys(chats || {}) });
      });

      sock.ev.on('messages.delete', (keys: any) => {
        this.appendDebug('messages.delete received', { keys });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.appendDebug('connect failed', errorMessage);
      console.error('[baileys] connect failed:', errorMessage);
      this.status = 'error';
      this.lastError = errorMessage;
      this.statusMessage = 'Failed to connect';
      this.qr = undefined;
      this.socket = null;
    }
  }

  private schedulePairingReconnect(): void {
    if (!this.pairingCode || this.pairingReconnectPending || this.pairingReconnectAttempts >= 2) {
      return;
    }

    this.pairingReconnectPending = true;
    this.pairingReconnectAttempts += 1;
    this.appendDebug('Scheduling pairing reconnect', { attempt: this.pairingReconnectAttempts });

    setTimeout(() => {
      this.pairingReconnectPending = false;
      if (!this.pairingCode || this.status === 'connected' || this.connectingPromise) {
        return;
      }

      this.appendDebug('Reconnecting for pairing flow', { attempt: this.pairingReconnectAttempts });
      this.connectingPromise = this.doConnect(false);
      void this.connectingPromise.finally(() => {
        this.connectingPromise = null;
      });
    }, 2500);
  }

  private async requestPairingCodeAfterHandshake(sock: any, phoneNumber: string): Promise<void> {
    if (this.pairingCodeRequested) {
      return;
    }

    this.pairingCodeRequested = true;
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (!sock?.requestPairingCode || this.status === 'error' || this.status === 'disconnected') {
      return;
    }

    try {
      this.appendDebug('Requesting pairing code', { phoneNumber });
      const pairingCode = await sock.requestPairingCode(phoneNumber);
      this.pairingCode = pairingCode;
      this.pairingMethod = 'pairing-code';
      this.status = 'qr';
      this.statusMessage = 'Pairing code ready. Open WhatsApp, go to Linked devices, and enter the code.';
      this.appendDebug('Pairing code received', { pairingCode });
      this.updateDebugInfo((info) => {
        info.pairingCode = pairingCode;
        info.pairingPhoneNumber = phoneNumber;
        info.pairingMethod = 'pairing-code';
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.appendDebug('Pairing code request failed', { error: errorMessage });
      this.updateDebugInfo((info) => {
        info.pairingCodeError = errorMessage;
      });
    }
  }

  async runDebugProbe(): Promise<BaileysDebugProbeResult> {
    return this.runDeepDebugProbe();
  }

  async runDeepDebugProbe(): Promise<BaileysDebugProbeResult> {
    const startedAt = Date.now();
    const authFolder = path.join(sessionDirectory, 'debug-probe-deep');
    const events: string[] = [];
    const timeline: string[] = [];

    const appendEvent = (message: string, detail?: unknown) => {
      const formattedDetail = detail === undefined ? '' : ` | ${this.safeStringify(detail)}`;
      const entry = `${new Date().toISOString()} ${message}${formattedDetail}`;
      events.push(entry);
      timeline.push(entry);
      this.appendDebug(message, detail);
    };

    const collectEnvironmentSnapshot = () => ({
      cwd: process.cwd(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      backendUrl: process.env.BACKEND_URL ?? process.env.API_URL ?? null,
      devSchoolId: process.env.DEV_SCHOOL_ID ?? null,
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      hostname: os.hostname(),
      networkInterfaces: Object.entries(os.networkInterfaces()).reduce((acc, [name, values]) => {
        acc[name] = (values ?? []).map((value) => ({ address: value.address, family: value.family, internal: value.internal }));
        return acc;
      }, {} as Record<string, unknown>),
    });

    try {
      fs.rmSync(authFolder, { recursive: true, force: true });
      appendEvent('Starting deep Baileys debug probe', { authFolder });

      const environment = collectEnvironmentSnapshot();
      const packageJsonPath = path.resolve(process.cwd(), 'package.json');
      let packageInfo: Record<string, unknown> = {};
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
        packageInfo = {
          name: packageJson.name,
          version: packageJson.version,
          dependencies: packageJson.dependencies ?? {},
        };
      } catch (error) {
        packageInfo = { error: error instanceof Error ? error.message : String(error) };
      }

      const dnsChecks = await Promise.allSettled([
        new Promise<{ host: string; address?: string; error?: string }>((resolve) => {
          dns.lookup('web.whatsapp.com', (error, address) => resolve({ host: 'web.whatsapp.com', address, error: error?.message }));
        }),
        new Promise<{ host: string; address?: string; error?: string }>((resolve) => {
          dns.lookup('v.whatsapp.net', (error, address) => resolve({ host: 'v.whatsapp.net', address, error: error?.message }));
        }),
      ]);

      let baileys: any;
      let makeWASocket: any;
      let useMultiFileAuthState: any;
      let Browsers: any;
      let fetchLatestWaWebVersion: any;

      try {
        baileys = await import('@whiskeysockets/baileys');
        makeWASocket = baileys.makeWASocket ?? baileys.default?.default;
        ({ useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys);
        appendEvent('Imported maintained Baileys package', { package: '@whiskeysockets/baileys' });
      } catch (error) {
        baileys = await import('@adiwajshing/baileys/lib/index.js');
        const socketModule: any = await import('@adiwajshing/baileys/lib/Socket/index.js');
        makeWASocket = socketModule?.default?.default ?? socketModule?.default ?? socketModule;
        ({ useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys);
        appendEvent('Fell back to legacy Baileys package', { package: '@adiwajshing/baileys' });
      }

      let version = [2, 3000, 1015901308];
      try {
        const versionMeta = await fetchLatestWaWebVersion();
        if (versionMeta?.version && Array.isArray(versionMeta.version)) {
          version = versionMeta.version;
        }
        appendEvent('Fetched WhatsApp Web version', { version });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        appendEvent('Failed to fetch latest WhatsApp Web version, using fallback', { error: errorMessage });
      }

      const authSnapshotBefore = {
        authFolderExists: fs.existsSync(authFolder),
        authFolderEntries: fs.existsSync(authFolder) ? fs.readdirSync(authFolder) : [],
        sessionDirectoryEntries: fs.existsSync(sessionDirectory) ? fs.readdirSync(sessionDirectory) : [],
      };
      appendEvent('Auth snapshot before connect', authSnapshotBefore);

      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      appendEvent('Created multi-file auth state', { authFolder });

      class BufferedLogger {
        public readonly messages: string[] = [];
        public level = 'trace';

        constructor(private readonly sink: (entry: string) => void) {}

        child() {
          return this;
        }

        private write(level: string, ...args: unknown[]) {
          const message = args.map((arg) => (typeof arg === 'string' ? arg : this.safeStringify(arg))).join(' ');
          const entry = `[baileys:${level}] ${message}`;
          this.messages.push(entry);
          this.sink(entry);
        }

        private safeStringify(value: unknown): string {
          try {
            return typeof value === 'string' ? value : JSON.stringify(value);
          } catch {
            return String(value);
          }
        }

        trace(...args: unknown[]) { this.write('trace', ...args); }
        debug(...args: unknown[]) { this.write('debug', ...args); }
        info(...args: unknown[]) { this.write('info', ...args); }
        warn(...args: unknown[]) { this.write('warn', ...args); }
        error(...args: unknown[]) { this.write('error', ...args); }
      }

      const logger = new BufferedLogger((entry: string) => {
        appendEvent(entry);
      });

      const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        browser: Browsers.macOS('SchoolBaseDeepDebug'),
        qrTimeout: 10 * 60 * 1000,
        connectTimeoutMs: 60 * 1000,
        keepAliveIntervalMs: 30 * 1000,
        markOnlineOnConnect: false,
        logger: logger as any,
        getMessage: async () => undefined,
      });

      sock.ev.on('connection.update', (update: any) => {
        appendEvent('connection.update', update);
      });

      sock.ev.on('creds.update', (credsUpdate: any) => {
        appendEvent('creds.update', { keys: Object.keys(credsUpdate || {}) });
        try { saveCreds(credsUpdate); } catch (e) { appendEvent('saveCreds failed', e); }
      });

      await new Promise((resolve) => setTimeout(resolve, 45000));

      const authSnapshotAfter = {
        authFolderExists: fs.existsSync(authFolder),
        authFolderEntries: fs.existsSync(authFolder) ? fs.readdirSync(authFolder) : [],
      };
      appendEvent('Auth snapshot after connect', authSnapshotAfter);

      return {
        ok: true,
        summary: events.at(-1) ?? 'No detailed events captured',
        events,
        timeline,
        durationMs: Date.now() - startedAt,
        authFolder,
        version,
        environment: { ...environment, dnsChecks: dnsChecks.map((result) => result.status === 'fulfilled' ? result.value : result.reason) },
        packageInfo,
        authSnapshot: authSnapshotAfter,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
      appendEvent('deep debug probe failed', errorMessage);
      return {
        ok: false,
        summary: errorMessage,
        events,
        timeline,
        durationMs: Date.now() - startedAt,
        authFolder,
        version: [2, 3000, 1015901308],
        error: errorMessage,
        environment: collectEnvironmentSnapshot(),
        packageInfo: {},
        authSnapshot: {
          authFolderExists: fs.existsSync(authFolder),
          authFolderEntries: fs.existsSync(authFolder) ? fs.readdirSync(authFolder) : [],
        },
      };
    }
  }
}

export class BaileysSessionManager {
  private sessions = new Map<string, BaileysSchoolSession>();

  private getOrCreateSession(schoolId: string): BaileysSchoolSession {
    if (!this.sessions.has(schoolId)) {
      this.sessions.set(schoolId, new BaileysSchoolSession(schoolId));
    }
    return this.sessions.get(schoolId)!;
  }

  getStatus(schoolId: string): BaileysSessionSnapshot {
    const session = this.getOrCreateSession(schoolId);
    return session.getStatus();
  }

  async connect(schoolId: string, pairingPhoneNumber?: string, usePairingCode = false): Promise<BaileysSessionSnapshot> {
    const session = this.getOrCreateSession(schoolId);
    return session.connect(pairingPhoneNumber, usePairingCode);
  }

  async disconnect(schoolId: string): Promise<BaileysSessionSnapshot> {
    const session = this.getOrCreateSession(schoolId);
    return session.disconnect();
  }

  private getManagerFallbackContext(): { status?: BaileysSessionStatus; phoneNumber?: string; socket?: any } {
    const managerState = this as any;
    return {
      status: managerState.status as BaileysSessionStatus | undefined,
      phoneNumber: managerState.phoneNumber as string | undefined,
      socket: managerState.socket as any,
    };
  }

  private async sendWithManagerFallback(schoolId: string, recipient: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const fallbackContext = this.getManagerFallbackContext();
    if (fallbackContext.status === 'connected' && fallbackContext.phoneNumber && fallbackContext.socket) {
      const normalizedRecipient = normalizeWhatsappRecipient(recipient);
      if (!normalizedRecipient) {
        return { success: false, error: 'Invalid recipient phone number' };
      }

      try {
        const res = await fallbackContext.socket.sendMessage(normalizedRecipient, { text: message });
        const messageId = res?.key?.id ? String(res.key.id) : undefined;
        return { success: true, messageId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
      }
    }

    const session = this.getOrCreateSession(schoolId);
    return session.sendTextMessage(recipient, message);
  }

  async sendTextMessage(schoolId: string, recipient: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.sendWithManagerFallback(schoolId, recipient, message);
  }

  async sendTextMessages(schoolId: string, recipients: string | string[], message: string): Promise<{ success: boolean; results: Array<{ recipient: string; success: boolean; error?: string }> }> {
    const fallbackContext = this.getManagerFallbackContext();
    if (fallbackContext.status === 'connected' && fallbackContext.phoneNumber && fallbackContext.socket) {
      const recipientList = Array.isArray(recipients) ? recipients : [recipients];
      const results: Array<{ recipient: string; success: boolean; error?: string }> = [];

      for (const recipient of recipientList) {
        const result = await this.sendWithManagerFallback(schoolId, recipient, message);
        results.push({ recipient, ...result });
      }

      return { success: results.every((r) => r.success), results };
    }

    const session = this.getOrCreateSession(schoolId);
    return session.sendTextMessages(recipients, message);
  }

  async runDeepDebugProbe(): Promise<BaileysDebugProbeResult> {
    const startedAt = Date.now();
    const authFolder = path.join(sessionDirectory, 'debug-probe-deep');
    const events: string[] = [];
    const timeline: string[] = [];

    const appendEvent = (message: string, detail?: unknown) => {
      const formattedDetail = detail === undefined ? '' : ` | ${this.safeStringify(detail)}`;
      const entry = `${new Date().toISOString()} ${message}${formattedDetail}`;
      events.push(entry);
      timeline.push(entry);
    };

    const collectEnvironmentSnapshot = () => ({
      cwd: process.cwd(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      backendUrl: process.env.BACKEND_URL ?? process.env.API_URL ?? null,
      devSchoolId: process.env.DEV_SCHOOL_ID ?? null,
      hasSessionSecret: Boolean(process.env.SESSION_SECRET),
      hostname: os.hostname(),
      networkInterfaces: Object.entries(os.networkInterfaces()).reduce((acc, [name, values]) => {
        acc[name] = (values ?? []).map((value) => ({ address: value.address, family: value.family, internal: value.internal }));
        return acc;
      }, {} as Record<string, unknown>),
    });

    try {
      fs.rmSync(authFolder, { recursive: true, force: true });
      appendEvent('Starting deep Baileys debug probe', { authFolder });

      const environment = collectEnvironmentSnapshot();
      const packageJsonPath = path.resolve(process.cwd(), 'package.json');
      let packageInfo: Record<string, unknown> = {};
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
        packageInfo = {
          name: packageJson.name,
          version: packageJson.version,
          dependencies: packageJson.dependencies ?? {},
        };
      } catch (error) {
        packageInfo = { error: error instanceof Error ? error.message : String(error) };
      }

      const dnsChecks = await Promise.allSettled([
        new Promise<{ host: string; address?: string; error?: string }>((resolve) => {
          dns.lookup('web.whatsapp.com', (error, address) => resolve({ host: 'web.whatsapp.com', address, error: error?.message }));
        }),
        new Promise<{ host: string; address?: string; error?: string }>((resolve) => {
          dns.lookup('v.whatsapp.net', (error, address) => resolve({ host: 'v.whatsapp.net', address, error: error?.message }));
        }),
      ]);

      let baileys: any;
      let makeWASocket: any;
      let useMultiFileAuthState: any;
      let Browsers: any;
      let fetchLatestWaWebVersion: any;

      try {
        baileys = await import('@whiskeysockets/baileys');
        makeWASocket = baileys.makeWASocket ?? baileys.default?.default;
        ({ useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys);
        appendEvent('Imported maintained Baileys package', { package: '@whiskeysockets/baileys' });
      } catch (error) {
        baileys = await import('@adiwajshing/baileys/lib/index.js');
        const socketModule: any = await import('@adiwajshing/baileys/lib/Socket/index.js');
        makeWASocket = socketModule?.default?.default ?? socketModule?.default ?? socketModule;
        ({ useMultiFileAuthState, Browsers, fetchLatestWaWebVersion } = baileys);
        appendEvent('Fell back to legacy Baileys package', { package: '@adiwajshing/baileys' });
      }

      let version = [2, 3000, 1015901308];
      try {
        const versionMeta = await fetchLatestWaWebVersion();
        if (versionMeta?.version && Array.isArray(versionMeta.version)) {
          version = versionMeta.version;
        }
        appendEvent('Fetched WhatsApp Web version', { version });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        appendEvent('Failed to fetch latest WhatsApp Web version, using fallback', { error: errorMessage });
      }

      const authSnapshotBefore = {
        authFolderExists: fs.existsSync(authFolder),
        authFolderEntries: fs.existsSync(authFolder) ? fs.readdirSync(authFolder) : [],
        sessionDirectoryEntries: fs.existsSync(sessionDirectory) ? fs.readdirSync(sessionDirectory) : [],
      };
      appendEvent('Auth snapshot before connect', authSnapshotBefore);

      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      appendEvent('Created multi-file auth state', { authFolder });

      class BufferedLogger {
        public readonly messages: string[] = [];
        public level = 'trace';

        constructor(private readonly sink: (entry: string) => void) {}

        child() {
          return this;
        }

        private write(level: string, ...args: unknown[]) {
          const message = args.map((arg) => (typeof arg === 'string' ? arg : this.safeStringify(arg))).join(' ');
          const entry = `[baileys:${level}] ${message}`;
          this.messages.push(entry);
          this.sink(entry);
        }

        private safeStringify(value: unknown): string {
          try {
            return typeof value === 'string' ? value : JSON.stringify(value);
          } catch {
            return String(value);
          }
        }

        trace(...args: unknown[]) { this.write('trace', ...args); }
        debug(...args: unknown[]) { this.write('debug', ...args); }
        info(...args: unknown[]) { this.write('info', ...args); }
        warn(...args: unknown[]) { this.write('warn', ...args); }
        error(...args: unknown[]) { this.write('error', ...args); }
      }

      const logger = new BufferedLogger((entry: string) => {
        appendEvent(entry);
      });

      const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        browser: Browsers.macOS('SchoolBaseDeepDebug'),
        qrTimeout: 10 * 60 * 1000,
        connectTimeoutMs: 60 * 1000,
        keepAliveIntervalMs: 30 * 1000,
        markOnlineOnConnect: false,
        logger: logger as any,
        getMessage: async () => undefined,
      });

      sock.ev.on('connection.update', (update: any) => {
        appendEvent('connection.update', update);
      });

      sock.ev.on('creds.update', (credsUpdate: any) => {
        appendEvent('creds.update', { keys: Object.keys(credsUpdate || {}) });
        try { saveCreds(credsUpdate); } catch (e) { appendEvent('saveCreds failed', e); }
      });

      await new Promise((resolve) => setTimeout(resolve, 45000));

      const authSnapshotAfter = {
        authFolderExists: fs.existsSync(authFolder),
        authFolderEntries: fs.existsSync(authFolder) ? fs.readdirSync(authFolder) : [],
      };
      appendEvent('Auth snapshot after connect', authSnapshotAfter);

      return {
        ok: true,
        summary: events.at(-1) ?? 'No detailed events captured',
        events,
        timeline,
        durationMs: Date.now() - startedAt,
        authFolder,
        version,
        environment: { ...environment, dnsChecks: dnsChecks.map((result) => result.status === 'fulfilled' ? result.value : result.reason) },
        packageInfo,
        authSnapshot: authSnapshotAfter,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
      appendEvent('deep debug probe failed', errorMessage);
      return {
        ok: false,
        summary: errorMessage,
        events,
        timeline,
        durationMs: Date.now() - startedAt,
        authFolder,
        version: [2, 3000, 1015901308],
        error: errorMessage,
        environment: collectEnvironmentSnapshot(),
        packageInfo: {},
        authSnapshot: {
          authFolderExists: fs.existsSync(authFolder),
          authFolderEntries: fs.existsSync(authFolder) ? fs.readdirSync(authFolder) : [],
        },
      };
    }
  }

  private safeStringify(value: unknown): string {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

export const baileysSessionManager = new BaileysSessionManager();
export default baileysSessionManager;