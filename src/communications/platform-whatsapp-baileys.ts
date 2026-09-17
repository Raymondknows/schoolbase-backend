import * as path from 'path';
import { baileysSessionManager } from './whatsapp-baileys.js';

export type PlatformWhatsAppProvider = 'BAILEYS';
export type PlatformWhatsAppSessionStatus = 'idle' | 'connecting' | 'qr' | 'connected' | 'disconnected' | 'error';

export interface PlatformWhatsAppSessionSnapshot {
  provider: PlatformWhatsAppProvider;
  status: string;
  statusMessage?: string;
  sessionNamespace: string;
  connected: boolean;
  phoneNumber: string | null;
  health: 'healthy' | 'degraded' | 'not-configured';
  updatedAt: string | null;
  lastError?: string;
  qr?: string;
  pairingCode?: string;
  pairingMethod?: string;
  debugInfo?: Record<string, unknown>;
}

const platformSessionNamespace = 'platform-admin';
const platformSessionDirectory = path.resolve(process.cwd(), '.baileys-session', platformSessionNamespace, 'auth_info');

export class PlatformBaileysSessionManager {
  private readonly sessionNamespace = platformSessionNamespace;
  private readonly session: {
    status: PlatformWhatsAppSessionStatus;
    phoneNumber: string | null;
    qr?: string;
    pairingCode?: string;
    pairingMethod?: string;
    lastError?: string;
    socket: any;
    sessionNamespace: string;
    debugInfo?: Record<string, unknown>;
  } = {
    status: 'disconnected',
    phoneNumber: null,
    socket: null,
    sessionNamespace: platformSessionNamespace,
  };

  getSession(): typeof this.session {
    return this.session;
  }

  getSessionNamespace(): string {
    return this.sessionNamespace;
  }

  private syncSessionSnapshot(snapshot: ReturnType<typeof baileysSessionManager.getStatus>): void {
    this.session.status = snapshot.status === 'connected' ? 'connected' : snapshot.status === 'qr' ? 'qr' : snapshot.status === 'connecting' ? 'connecting' : snapshot.status === 'error' ? 'error' : 'disconnected';
    this.session.phoneNumber = snapshot.phoneNumber ?? null;
    this.session.qr = snapshot.qr;
    this.session.pairingCode = snapshot.pairingCode;
    this.session.pairingMethod = snapshot.pairingMethod;
    this.session.lastError = snapshot.lastError;
    this.session.debugInfo = snapshot.debugInfo;
  }

  private mapSnapshot(snapshot: ReturnType<typeof baileysSessionManager.getStatus>): PlatformWhatsAppSessionSnapshot {
    const normalizedStatus = snapshot.status === 'connected' ? 'connected' : snapshot.status === 'qr' ? 'qr' : snapshot.status === 'connecting' ? 'connecting' : snapshot.status === 'error' ? 'error' : 'disconnected';

    return {
      provider: 'BAILEYS',
      status: normalizedStatus,
      statusMessage: snapshot.statusMessage,
      sessionNamespace: this.sessionNamespace,
      connected: normalizedStatus === 'connected',
      phoneNumber: snapshot.phoneNumber ?? null,
      health: normalizedStatus === 'connected' ? 'healthy' : normalizedStatus === 'error' ? 'degraded' : 'not-configured',
      updatedAt: normalizedStatus === 'connected' || normalizedStatus === 'error' ? new Date().toISOString() : null,
      lastError: snapshot.lastError,
      qr: snapshot.qr,
      pairingCode: snapshot.pairingCode,
      pairingMethod: snapshot.pairingMethod,
      debugInfo: snapshot.debugInfo,
    };
  }

  async connect(pairingPhoneNumber?: string, usePairingCode = false): Promise<PlatformWhatsAppSessionSnapshot> {
    this.session.status = 'connecting';
    this.session.lastError = undefined;
    this.session.qr = undefined;
    const snapshot = await baileysSessionManager.connect(this.sessionNamespace, pairingPhoneNumber, usePairingCode);
    this.syncSessionSnapshot(snapshot);
    return this.mapSnapshot(snapshot);
  }

  async disconnect(): Promise<PlatformWhatsAppSessionSnapshot> {
    const snapshot = await baileysSessionManager.disconnect(this.sessionNamespace);
    this.syncSessionSnapshot(snapshot);
    this.session.socket = null;
    return this.mapSnapshot(snapshot);
  }

  async sendTextMessage(recipient: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.session.socket && this.session.status === 'connected') {
      try {
        const result = await this.session.socket.sendMessage(recipient, { text: message });
        return { success: true, messageId: result?.key?.id || `platform-${Date.now()}` };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.session.lastError = errorMessage;
        return { success: false, error: errorMessage };
      }
    }

    return baileysSessionManager.sendTextMessage(this.sessionNamespace, recipient, message);
  }

  getStatus(): PlatformWhatsAppSessionSnapshot {
    const snapshot = baileysSessionManager.getStatus(this.sessionNamespace);
    this.syncSessionSnapshot(snapshot);
    return this.mapSnapshot(snapshot);
  }

  getAuthDirectory(): string {
    return platformSessionDirectory;
  }
}

export const platformBaileysSessionManager = new PlatformBaileysSessionManager();
export default platformBaileysSessionManager;
