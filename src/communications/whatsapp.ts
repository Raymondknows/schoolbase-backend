import { mkdir, rm } from 'fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { create, SocketState, Whatsapp } from '@wppconnect-team/wppconnect';

export interface WhatsAppSessionSnapshot {
  schoolId: string;
  status: 'idle' | 'connecting' | 'qr' | 'connected' | 'disconnected' | 'error';
  connectedAt?: string;
  lastError?: string;
  statusMessage?: string;
  debugEvents?: string[];
  qr?: string;
  phoneNumber?: string;
}

function resolveChromeExecutable(): string | undefined {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.CHROMIUM_BIN,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const macOSCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  for (const candidate of macOSCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function resolveWhatsAppStateFile(schoolId?: string): string {
  const safeSchoolId = sanitizeSchoolId(schoolId);
  return path.resolve(process.cwd(), '.whatsapp-session-state', `${safeSchoolId}.json`);
}

export function writeWhatsAppSessionSnapshotToDisk(schoolId: string, snapshot: WhatsAppSessionSnapshot): void {
  const stateFile = resolveWhatsAppStateFile(schoolId);
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(snapshot, null, 2), 'utf8');
}

export function readWhatsAppSessionSnapshotFromDisk(schoolId?: string): WhatsAppSessionSnapshot | undefined {
  const stateFile = resolveWhatsAppStateFile(schoolId);
  if (!existsSync(stateFile)) {
    return undefined;
  }

  try {
    const raw = readFileSync(stateFile, 'utf8');
    return JSON.parse(raw) as WhatsAppSessionSnapshot;
  } catch (error) {
    console.warn(`[whatsapp] failed to read persisted session state for ${schoolId}`, error);
    return undefined;
  }
}

class WhatsAppSessionManager {
  private readonly sessions = new Map<string, { client: Whatsapp; state: WhatsAppSessionSnapshot }>();
  private readonly statusBySchool = new Map<string, WhatsAppSessionSnapshot>();
  private readonly pendingConnects = new Map<string, Promise<WhatsAppSessionSnapshot>>();

  private updateSnapshot(schoolId: string, updater: (snapshot: WhatsAppSessionSnapshot) => void): WhatsAppSessionSnapshot {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const snapshot = this.getStatus(normalizedSchoolId);
    updater(snapshot);
    this.statusBySchool.set(normalizedSchoolId, snapshot);
    try {
      writeWhatsAppSessionSnapshotToDisk(normalizedSchoolId, snapshot);
    } catch (error) {
      console.warn(`[whatsapp] failed to persist session state for ${normalizedSchoolId}`, error);
    }
    return snapshot;
  }

  private addDebugEvent(schoolId: string, message: string, details?: unknown): WhatsAppSessionSnapshot {
    return this.updateSnapshot(schoolId, (snapshot) => {
      const detailText = details === undefined ? '' : ` — ${typeof details === 'string' ? details : JSON.stringify(details)}`;
      const nextEvent = `${new Date().toLocaleTimeString()} ${message}${detailText}`;
      snapshot.debugEvents = [...(snapshot.debugEvents ?? []), nextEvent].slice(-10);
      snapshot.statusMessage = message;
    });
  }

  private async clearSessionDirectory(schoolId: string, sessionDirectory: string): Promise<void> {
    try {
      await rm(sessionDirectory, { recursive: true, force: true });
      console.log(`[whatsapp] cleared stale session directory for ${schoolId}`);
    } catch (error) {
      console.warn(`[whatsapp] failed to clear stale session directory for ${schoolId}`, error);
    }
  }

  async connect(schoolId: string): Promise<WhatsAppSessionSnapshot> {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const existing = this.sessions.get(normalizedSchoolId);
    if (existing?.client && existing.state.status === 'connected') {
      const isConnected = await existing.client.isConnected().catch(() => false);
      if (isConnected) {
        return this.getStatus(normalizedSchoolId);
      }
    }

    if (existing?.client) {
      this.sessions.delete(normalizedSchoolId);
    }

    const pendingConnect = this.pendingConnects.get(normalizedSchoolId);
    if (pendingConnect) {
      return this.getStatus(normalizedSchoolId);
    }

    const initialState: WhatsAppSessionSnapshot = {
      schoolId: normalizedSchoolId,
      status: 'connecting',
      statusMessage: 'Starting WhatsApp connection…',
      debugEvents: ['Connection started'],
      qr: undefined,
    };
    this.statusBySchool.set(normalizedSchoolId, initialState);

    const sessionDirectory = resolveWhatsAppSessionDirectory(normalizedSchoolId);
    await mkdir(sessionDirectory, { recursive: true });

    const connectPromise = (async (): Promise<WhatsAppSessionSnapshot> => {
      const chromeExecutable = resolveChromeExecutable();

      const buildConnectOptions = () => ({
        session: normalizedSchoolId,
        folderNameToken: '.whatsapp-sessions',
        disableWelcome: true,
        updatesLog: false,
        autoClose: 0,
        waitForLogin: false,
        headless: true,
        useChrome: false,
        deviceSyncTimeout: 300000,
        puppeteerOptions: {
          executablePath: chromeExecutable,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1280,720',
          ],
        },
        catchQR: (qrCode: string) => {
          this.addDebugEvent(normalizedSchoolId, 'QR code generated. Scan it in WhatsApp.');
          this.updateSnapshot(normalizedSchoolId, (snapshot) => {
            snapshot.status = 'qr';
            snapshot.qr = qrCode;
            snapshot.lastError = undefined;
          });
        },
        statusFind: (status: string) => {
          this.addDebugEvent(normalizedSchoolId, `WhatsApp status changed: ${status}`);
        },
      });

      const tryCreate = async (attempt: number): Promise<Whatsapp> => {
        try {
          return await create(buildConnectOptions());
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isBrowserLockError = /browser is already running|userDataDir|running browser/i.test(message);
          if (attempt === 1 && isBrowserLockError) {
            this.addDebugEvent(normalizedSchoolId, 'Browser profile was locked. Clearing stale session state and retrying…');
            await this.clearSessionDirectory(normalizedSchoolId, sessionDirectory);
            await mkdir(sessionDirectory, { recursive: true });
            return tryCreate(attempt + 1);
          }
          throw error;
        }
      };

      try {
        const client = await tryCreate(1);

        const waitForPhoneDeviceSync = async (): Promise<string | undefined> => {
          for (let attempt = 1; attempt <= 6; attempt += 1) {
            const hostDevice = await client.getHostDevice().catch(() => undefined);
            const rawId = hostDevice?.id;
            const phoneNumber = rawId?.split('@')[0];
            const isValidPhoneNumber = phoneNumber && phoneNumber.length > 3 && /^\d+$/.test(phoneNumber);

            if (isValidPhoneNumber) {
              return phoneNumber;
            }

            this.addDebugEvent(normalizedSchoolId, `Phone device not properly synced. Device returned: ${rawId ?? 'undefined'}. Waiting for sync…`);
            this.updateSnapshot(normalizedSchoolId, (snapshot) => {
              snapshot.status = 'connecting';
              snapshot.statusMessage = 'Syncing with phone device…';
            });

            if (attempt < 6) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }
          return undefined;
        };

        client.onStateChange(async (state) => {
          console.log(`[whatsapp:${normalizedSchoolId}] state change`, state);
          if (state === SocketState.PAIRING) {
            this.addDebugEvent(normalizedSchoolId, 'Waiting for QR scan to complete.');
            this.updateSnapshot(normalizedSchoolId, (snapshot) => {
              snapshot.status = 'qr';
              snapshot.statusMessage = 'Waiting for QR code scan…';
            });
            return;
          }

          if (state === SocketState.OPENING || state === SocketState.UNLAUNCHED) {
            this.addDebugEvent(normalizedSchoolId, 'Connecting to WhatsApp…');
            this.updateSnapshot(normalizedSchoolId, (snapshot) => {
              snapshot.status = 'connecting';
              snapshot.statusMessage = 'Connecting to WhatsApp…';
            });
            return;
          }

          if (state === SocketState.CONNECTED) {
            this.addDebugEvent(normalizedSchoolId, 'Connected successfully. Verifying phone device…');
            const phoneNumber = await waitForPhoneDeviceSync();

            if (phoneNumber) {
              this.addDebugEvent(normalizedSchoolId, 'Phone device synced. WhatsApp is ready to send messages.');
              this.updateSnapshot(normalizedSchoolId, (snapshot) => {
                snapshot.status = 'connected';
                snapshot.connectedAt = new Date().toISOString();
                snapshot.lastError = undefined;
                snapshot.phoneNumber = phoneNumber;
                snapshot.statusMessage = 'WhatsApp connected successfully.';
              });
            } else {
              this.addDebugEvent(normalizedSchoolId, 'Phone device sync did not complete in time. Marking WhatsApp as error.');
              this.sessions.delete(normalizedSchoolId);
              this.updateSnapshot(normalizedSchoolId, (snapshot) => {
                snapshot.status = 'error';
                snapshot.connectedAt = undefined;
                snapshot.phoneNumber = snapshot.phoneNumber;
                snapshot.lastError = 'Phone device did not sync in time. Reconnect to restore WhatsApp delivery.';
                snapshot.statusMessage = 'WhatsApp connected, but phone device sync failed. Reconnect the session.';
              });
            }
            return;
          }

          if (state === SocketState.UNPAIRED || state === SocketState.UNPAIRED_IDLE) {
            this.addDebugEvent(normalizedSchoolId, 'WhatsApp session is unpaired or idle.');
            this.updateSnapshot(normalizedSchoolId, (snapshot) => {
              snapshot.status = 'disconnected';
              snapshot.statusMessage = 'WhatsApp session is not paired.';
            });
            this.sessions.delete(normalizedSchoolId);
            return;
          }

          if ([SocketState.TIMEOUT, SocketState.PROXYBLOCK, SocketState.SMB_TOS_BLOCK, SocketState.TOS_BLOCK, SocketState.CONFLICT, SocketState.DEPRECATED_VERSION].includes(state)) {
            this.addDebugEvent(normalizedSchoolId, 'WhatsApp connection error.', state);
            this.updateSnapshot(normalizedSchoolId, (snapshot) => {
              snapshot.status = 'error';
              snapshot.lastError = `WhatsApp state: ${state}`;
              snapshot.statusMessage = `WhatsApp error: ${state}`;
            });
            this.sessions.delete(normalizedSchoolId);
            await this.clearSessionDirectory(normalizedSchoolId, sessionDirectory);
          }
        });

        this.sessions.set(normalizedSchoolId, { client, state: this.getStatus(normalizedSchoolId) });
        return this.getStatus(normalizedSchoolId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.addDebugEvent(normalizedSchoolId, `Failed to start WhatsApp session: ${message}`);
        this.updateSnapshot(normalizedSchoolId, (snapshot) => {
          snapshot.status = 'error';
          snapshot.lastError = message;
          snapshot.statusMessage = 'Failed to connect WhatsApp';
        });
        return this.getStatus(normalizedSchoolId);
      } finally {
        this.pendingConnects.delete(normalizedSchoolId);
      }
    })();

    this.pendingConnects.set(normalizedSchoolId, connectPromise);
    return this.getStatus(normalizedSchoolId);
  }

  async disconnect(schoolId: string): Promise<WhatsAppSessionSnapshot> {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const existing = this.sessions.get(normalizedSchoolId);
    if (existing?.client) {
      await existing.client.logout();
      this.sessions.delete(normalizedSchoolId);
    }

    const snapshot = this.getStatus(normalizedSchoolId);
    snapshot.status = 'idle';
    snapshot.qr = undefined;
    snapshot.lastError = undefined;
    snapshot.statusMessage = 'Disconnected';
    snapshot.debugEvents = [...(snapshot.debugEvents ?? []), `${new Date().toLocaleTimeString()} Disconnected from WhatsApp.`].slice(-10);
    this.statusBySchool.set(normalizedSchoolId, snapshot);
    return snapshot;
  }

  getStatus(schoolId: string): WhatsAppSessionSnapshot {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const existing = this.statusBySchool.get(normalizedSchoolId);
    if (existing) {
      return { ...existing };
    }

    const persistedSnapshot = readWhatsAppSessionSnapshotFromDisk(normalizedSchoolId);
    if (persistedSnapshot) {
      const staleStatuses = ['connecting', 'qr'];
      if (staleStatuses.includes(persistedSnapshot.status)) {
        const staleSnapshot: WhatsAppSessionSnapshot = {
          ...persistedSnapshot,
          status: 'idle',
          statusMessage: 'WhatsApp session state restored from disk. Reconnect to reestablish the session.',
          qr: undefined,
        };
        this.statusBySchool.set(normalizedSchoolId, staleSnapshot);
        return { ...staleSnapshot };
      }

      if (persistedSnapshot.status === 'connected' && !this.sessions.has(normalizedSchoolId)) {
        const restoreSnapshot: WhatsAppSessionSnapshot = {
          ...persistedSnapshot,
          status: 'connecting',
          statusMessage: 'Restoring WhatsApp session from disk...',
          qr: undefined,
          debugEvents: [...(persistedSnapshot.debugEvents ?? []), `${new Date().toLocaleTimeString()} Restoring WhatsApp session from disk...`].slice(-10),
        };
        this.statusBySchool.set(normalizedSchoolId, restoreSnapshot);
        void this.connect(normalizedSchoolId).catch(() => undefined);
        return { ...restoreSnapshot };
      }

      this.statusBySchool.set(normalizedSchoolId, persistedSnapshot);
      return { ...persistedSnapshot };
    }

    const fallback: WhatsAppSessionSnapshot = {
      schoolId: normalizedSchoolId,
      status: 'idle',
    };
    this.statusBySchool.set(normalizedSchoolId, fallback);
    return fallback;
  }

  async sendTextMessage(schoolId: string, recipient: string, body: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);

    let client = this.sessions.get(normalizedSchoolId)?.client;

    if (!client) {
      let pendingConnect = this.pendingConnects.get(normalizedSchoolId);
      if (!pendingConnect) {
        await this.connect(normalizedSchoolId);
        pendingConnect = this.pendingConnects.get(normalizedSchoolId);
      }

      if (pendingConnect) {
        await pendingConnect;
      }

      client = this.sessions.get(normalizedSchoolId)?.client;
    }

    if (client) {
      const isSessionConnected = await client.isConnected().catch(() => false);
      if (!isSessionConnected) {
        const snapshot = this.getStatus(normalizedSchoolId);
        snapshot.status = 'disconnected';
        snapshot.statusMessage = 'WhatsApp session is not connected.';
        this.statusBySchool.set(normalizedSchoolId, snapshot);
        return { success: false, error: 'WhatsApp session is not connected yet' };
      }

      const hostDevice = await client.getHostDevice().catch(() => undefined);
      const rawId = hostDevice?.id;
      const phoneNumber = rawId?.split('@')[0];
      if (!phoneNumber || phoneNumber.length < 3) {
        const snapshot = this.getStatus(normalizedSchoolId);
        snapshot.status = 'error';
        snapshot.lastError = 'WhatsApp host device is not fully synced.';
        snapshot.statusMessage = 'WhatsApp session is connected but phone device sync is incomplete.';
        this.statusBySchool.set(normalizedSchoolId, snapshot);
        return { success: false, error: 'WhatsApp phone device is not synced. Reconnect the session.' };
      }
    }

    if (!client) {
      return { success: false, error: 'WhatsApp session is not connected yet' };
    }

    try {
      const normalizedRecipient = normalizeWhatsappRecipient(recipient);
      if (!normalizedRecipient) {
        return { success: false, error: 'Recipient is required' };
      }

      const result = await client.sendText(normalizedRecipient, body);
      return {
        success: true,
        messageId: result?.id ?? undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const snapshot = this.getStatus(normalizedSchoolId);
      snapshot.status = 'error';
      snapshot.lastError = message;
      this.statusBySchool.set(normalizedSchoolId, snapshot);
      return { success: false, error: message };
    }
  }
}

export function sanitizeSchoolId(schoolId?: string): string {
  const raw = String(schoolId || 'default').trim().toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export function resolveWhatsAppSessionDirectory(schoolId?: string): string {
  const safeSchoolId = sanitizeSchoolId(schoolId);
  return path.resolve(process.cwd(), '.whatsapp-sessions', safeSchoolId);
}

export function normalizeWhatsappRecipient(value?: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  if (trimmed.includes('@c.us') || trimmed.includes('@g.us')) {
    return trimmed;
  }

  if (trimmed.includes('@s.whatsapp.net')) {
    return `${digits}@c.us`;
  }

  return `${digits}@c.us`;
}

export function shouldClearWhatsAppSession(_statusCode?: number, errorMessage?: string): boolean {
  const normalizedMessage = `${errorMessage ?? ''}`.toLowerCase();
  const authFailureHints = [
    'logged out',
    'loggedout',
    'bad session',
    'invalid session',
    'session expired',
    'authentication',
    'unauthorized',
    'forbidden',
  ];

  return authFailureHints.some((hint) => normalizedMessage.includes(hint));
}

export const whatsappSessionManager = new WhatsAppSessionManager();
export default whatsappSessionManager;
