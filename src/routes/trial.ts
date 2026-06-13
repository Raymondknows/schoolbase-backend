import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { generateOtp, storeOtp, verifyOtp } from '../services/otp.js';
import { sendSignupOtpEmail, sendWelcomeEmail } from '../services/email.js';

const router = Router();
const prisma = new PrismaClient();

function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ?? "schoolbase-dev-secret-change-me",
  );
}

// POST /api/trial/request-otp - Request OTP for signup
router.post('/request-otp', async (req: Request, res: Response) => {
  try {
    const { schoolName, slug, country, adminName, adminEmail, password } = req.body;

    if (!schoolName || !slug || !country || !adminName || !adminEmail || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields'
      });
    }

    // Check if school slug already exists
    const existingSchool = await prisma.school.findUnique({
      where: { slug: slug.toLowerCase() },
    });

    if (existingSchool) {
      return res.status(409).json({ error: 'School slug already exists' });
    }

    // Check if email already exists as a completed user
    const existingUser = await prisma.user.findUnique({
      where: { email: adminEmail.toLowerCase() },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered. Please use a different email or contact support if you need to recover your account.' });
    }

    // Allow resending OTP if email is already in signup process
    const existingSignup = await prisma.signupOtp.findUnique({
      where: { email: adminEmail.toLowerCase() },
    });

    if (existingSignup && !existingSignup.verifiedAt) {
      console.log('Resending OTP to email already in signup process:', adminEmail);
    }

    // Generate and send OTP
    const otp = generateOtp();
    storeOtp(adminEmail, otp);

    // Send email synchronously (like password reset does) - wait for it to complete
    await sendSignupOtpEmail(adminEmail, otp, schoolName);

    return res.json({
      success: true,
      message: 'Verification code sent to your email',
      email: adminEmail,
    });
  } catch (error: any) {
    console.error('Request OTP error:', error);
    return res.status(500).json({
      error: 'Failed to send verification email',
      details: error.message,
    });
  }
});

// POST /api/trial/verify-otp - Verify OTP and create account
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { schoolName, slug, country, adminName, adminEmail, password, otp } = req.body;

    if (!schoolName || !slug || !country || !adminName || !adminEmail || !password || !otp) {
      return res.status(400).json({ 
        error: 'Missing required fields'
      });
    }

    // Verify OTP
    if (!verifyOtp(adminEmail, otp)) {
      return res.status(401).json({ 
        error: 'Invalid or expired verification code'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create school
    const school = await prisma.school.create({
      data: {
        name: schoolName,
        slug: slug.toLowerCase(),
        country,
        email: adminEmail,
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail.toLowerCase(),
        name: adminName,
        role: 'SCHOOL_ADMIN',
        passwordHash,
        schoolId: school.id,
      },
    });

    // Generate JWT token
    const token = await new SignJWT({
      userId: adminUser.id,
      schoolId: school.id,
      email: adminUser.email,
      name: adminUser.name,
      role: adminUser.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());

    // Send welcome email
    try {
      await sendWelcomeEmail(adminEmail, schoolName, adminName);
    } catch (emailError) {
      console.warn('Welcome email failed (non-blocking):', emailError);
    }

    return res.status(201).json({
      success: true,
      message: 'School registered successfully',
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
      },
      user: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role,
      },
      token,
    });
  } catch (error: any) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({
      error: 'Failed to create account',
      details: error.message,
    });
  }
});

// POST /api/trial/start - Start trial for a school
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { schoolId, days = 30 } = req.body;

    if (!schoolId) {
      return res.status(400).json({ error: 'Missing schoolId' });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + days);

    // Update school with trial end date
    const school = await prisma.school.update({
      where: { id: schoolId },
      data: {
        trialEndsAt,
        status: 'TRIAL',
      },
      select: {
        id: true,
        name: true,
        trialEndsAt: true,
        status: true,
      },
    });

    res.json({
      success: true,
      message: `Trial started for ${days} days`,
      school,
    });
  } catch (error: any) {
    console.error('Error starting trial:', error);
    res.status(500).json({
      error: 'Failed to start trial',
      details: error.message,
    });
  }
});

export default router;
