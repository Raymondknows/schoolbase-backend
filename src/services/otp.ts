// Simple in-memory OTP store with expiration
// In production, use Redis or database for persistence

interface OtpEntry {
  code: string;
  email: string;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpEntry>();

// Cleanup expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otpStore.entries()) {
    if (entry.expiresAt < now) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function generateOtp(): string {
  // Generate 6-digit OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function storeOtp(email: string, code: string, expirationMinutes = 10): void {
  const key = email.toLowerCase();
  otpStore.set(key, {
    code,
    email,
    expiresAt: Date.now() + expirationMinutes * 60 * 1000,
    attempts: 0,
  });
}

export function verifyOtp(email: string, code: string): boolean {
  const key = email.toLowerCase();
  const entry = otpStore.get(key);

  if (!entry) {
    return false;
  }

  // Check expiration
  if (entry.expiresAt < Date.now()) {
    otpStore.delete(key);
    return false;
  }

  // Check attempts (max 5 attempts)
  if (entry.attempts >= 5) {
    otpStore.delete(key);
    return false;
  }

  // Check code
  if (entry.code !== code) {
    entry.attempts += 1;
    return false;
  }

  // Valid OTP - remove it
  otpStore.delete(key);
  return true;
}

export function getOtpInfo(email: string): { expiresAt: number; attempts: number } | null {
  const key = email.toLowerCase();
  const entry = otpStore.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    return null;
  }

  return {
    expiresAt: entry.expiresAt,
    attempts: entry.attempts,
  };
}

export function deleteOtp(email: string): void {
  otpStore.delete(email.toLowerCase());
}
