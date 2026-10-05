import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getSessionSecret } from './security-config.js';

function snapshotKey() {
  return createHash('sha256')
    .update(getSessionSecret())
    .update(':schoolbase:id-card-render-snapshot:v1')
    .digest();
}

export function encryptIdCardSnapshot(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', snapshotKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptIdCardSnapshot<T>(value: string): T {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Unsupported ID-card snapshot format.');
  }

  const decipher = createDecipheriv('aes-256-gcm', snapshotKey(), Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as T;
}
