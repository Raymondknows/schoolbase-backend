import fs from 'fs';
import path from 'path';

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

export function sanitizeSchoolId(schoolId?: string): string {
  const raw = String(schoolId || 'default').trim().toLowerCase();
  return raw.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export function resolveWhatsAppSessionDirectory(schoolId?: string): string {
  const safeSchoolId = sanitizeSchoolId(schoolId);
  return path.resolve(process.cwd(), '.whatsapp-sessions', safeSchoolId);
}

export function resolveWhatsAppStateFile(schoolId?: string): string {
  return path.join(resolveWhatsAppSessionDirectory(schoolId), 'session.json');
}

export function writeWhatsAppSessionSnapshotToDisk(schoolId: string, snapshot: WhatsAppSessionSnapshot): void {
  const stateFile = resolveWhatsAppStateFile(schoolId);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(snapshot, null, 2), 'utf-8');
}

export function readWhatsAppSessionSnapshotFromDisk(schoolId?: string): WhatsAppSessionSnapshot | undefined {
  const stateFile = resolveWhatsAppStateFile(schoolId);
  if (!fs.existsSync(stateFile)) return undefined;

  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(raw) as WhatsAppSessionSnapshot;
  } catch {
    return undefined;
  }
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
    'auth failure',
    'session not found',
    'missing credentials',
  ];

  return authFailureHints.some((hint) => normalizedMessage.includes(hint));
}
