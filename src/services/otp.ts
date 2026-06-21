import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export function generateOtp(): string {
  // Generate 6-digit OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export interface SignupOtpPayload {
  email: string;
  schoolName: string;
  slug: string;
  country: string;
  adminName: string;
  password: string;
  otp: string;
  expirationMinutes?: number;
}

export interface SignupOtpRecord {
  email: string;
  schoolName: string;
  slug: string;
  country: string;
  adminName: string;
  passwordHash: string;
  otpHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function saveSignupOtp(payload: SignupOtpPayload): Promise<void> {
  const normalizedEmail = normalizeEmail(payload.email);
  const expirationMinutes = payload.expirationMinutes ?? 10;
  const [otpHash, passwordHash] = await Promise.all([
    bcrypt.hash(payload.otp, 10),
    bcrypt.hash(payload.password, 10),
  ]);

  await prisma.signupOtp.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      schoolName: payload.schoolName.trim(),
      slug: payload.slug.trim().toLowerCase(),
      country: payload.country.trim().toUpperCase(),
      adminName: payload.adminName.trim(),
      passwordHash,
      otpHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + expirationMinutes * 60 * 1000),
      verifiedAt: null,
    },
    update: {
      schoolName: payload.schoolName.trim(),
      slug: payload.slug.trim().toLowerCase(),
      country: payload.country.trim().toUpperCase(),
      adminName: payload.adminName.trim(),
      passwordHash,
      otpHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + expirationMinutes * 60 * 1000),
      verifiedAt: null,
    },
  });
}

export async function resendSignupOtp(
  email: string,
  otp: string,
  expirationMinutes = 10,
): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const entry = await prisma.signupOtp.findUnique({
    where: { email: normalizedEmail },
  });

  if (!entry || entry.verifiedAt) {
    return false;
  }

  await prisma.signupOtp.update({
    where: { email: normalizedEmail },
    data: {
      otpHash: await bcrypt.hash(otp, 10),
      attempts: 0,
      expiresAt: new Date(Date.now() + expirationMinutes * 60 * 1000),
    },
  });

  return true;
}

export async function verifySignupOtp(email: string, code: string): Promise<boolean> {
  const normalizedEmail = normalizeEmail(email);
  const entry = await prisma.signupOtp.findUnique({
    where: { email: normalizedEmail },
  });

  if (!entry || entry.verifiedAt) {
    return false;
  }

  if (entry.expiresAt.getTime() < Date.now()) {
    await prisma.signupOtp.delete({ where: { email: normalizedEmail } }).catch(() => {});
    return false;
  }

  if (entry.attempts >= 5) {
    await prisma.signupOtp.delete({ where: { email: normalizedEmail } }).catch(() => {});
    return false;
  }

  const valid = await bcrypt.compare(code, entry.otpHash);
  if (!valid) {
    await prisma.signupOtp.update({
      where: { email: normalizedEmail },
      data: { attempts: entry.attempts + 1 },
    });
    return false;
  }

  await prisma.signupOtp.update({
    where: { email: normalizedEmail },
    data: { verifiedAt: new Date() },
  });

  return true;
}

export async function getSignupOtp(email: string): Promise<SignupOtpRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  const entry = await prisma.signupOtp.findUnique({
    where: { email: normalizedEmail },
  });

  if (!entry) {
    return null;
  }

  return {
    email: entry.email,
    schoolName: entry.schoolName,
    slug: entry.slug,
    country: entry.country,
    adminName: entry.adminName,
    passwordHash: entry.passwordHash,
    otpHash: entry.otpHash,
    attempts: entry.attempts,
    expiresAt: entry.expiresAt,
    verifiedAt: entry.verifiedAt,
  };
}

export async function hasPendingOtp(email: string): Promise<boolean> {
  const entry = await prisma.signupOtp.findUnique({
    where: { email: normalizeEmail(email) },
    select: { verifiedAt: true, expiresAt: true },
  });

  return !!entry && !entry.verifiedAt && entry.expiresAt.getTime() >= Date.now();
}
