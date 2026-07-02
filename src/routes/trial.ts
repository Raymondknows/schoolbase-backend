import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { generateOtp, getSignupOtp, saveSignupOtp, verifySignupOtp } from '../services/otp.js';
import { sendSignupOtpEmail, sendWelcomeEmail } from '../services/email.js';
import { getPlatformSettingValue } from '../services/platform-settings.js';

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
    const maintenanceMode = await getPlatformSettingValue(prisma, 'maintenanceMode', false);
    const allowSignup = await getPlatformSettingValue(prisma, 'allowSignup', true);
    const allowTrial = await getPlatformSettingValue(prisma, 'allowTrial', true);

    if (maintenanceMode) {
      return res.status(503).json({ error: 'Platform is in maintenance mode. Signup is temporarily disabled.' });
    }

    if (!allowSignup) {
      return res.status(403).json({ error: 'New signups are currently disabled.' });
    }

    if (!allowTrial) {
      return res.status(403).json({ error: 'Trial signup is currently disabled.' });
    }

    const schoolName = String(req.body.schoolName ?? '').trim();
    const slug = String(req.body.slug ?? '').trim();
    const tagline = String(req.body.tagline ?? '').trim();
    const address = String(req.body.address ?? '').trim();
    const phone = String(req.body.phone ?? '').trim();
    const country = String(req.body.country ?? '').trim();
    const adminName = String(req.body.adminName ?? '').trim();
    const adminEmail = String(req.body.adminEmail ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');

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
      where: { email: adminEmail },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered. Please use a different email or contact support if you need to recover your account.' });
    }

    // Allow resending OTP if email is already in signup process
    const existingSignup = await prisma.signupOtp.findUnique({
      where: { email: adminEmail },
    });

    if (existingSignup && !existingSignup.verifiedAt) {
      console.log('Resending OTP to email already in signup process:', adminEmail);
    }

    // Generate and store OTP in the database
    const otp = generateOtp();
    await saveSignupOtp({
      email: adminEmail,
      schoolName,
      slug,
      country,
      adminName,
      password,
      otp,
    });

    // Send email asynchronously (don't await - return immediately)
    // This prevents the endpoint from hanging on SMTP timeouts
    sendSignupOtpEmail(adminEmail, otp, schoolName)
      .then(() => {
        console.log('OTP email sent successfully to:', adminEmail);
      })
      .catch((error) => {
        console.error('OTP email failed (non-blocking):', error);
        // Still allow signup flow even if email fails - user can retry
      });

    // Return success immediately without waiting for email
    return res.json({
      success: true,
      message: 'Verification code sent to your email',
      email: adminEmail,
    });
  } catch (error: any) {
    console.error('Request OTP error:', error);
    return res.status(500).json({
      error: 'Failed to request OTP',
      details: error.message,
    });
  }
});

// POST /api/trial/verify-otp - Verify OTP and create account
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const maintenanceMode = await getPlatformSettingValue(prisma, 'maintenanceMode', false);
    const allowSignup = await getPlatformSettingValue(prisma, 'allowSignup', true);
    const allowTrial = await getPlatformSettingValue(prisma, 'allowTrial', true);

    if (maintenanceMode) {
      return res.status(503).json({ error: 'Platform is in maintenance mode. Signup is temporarily disabled.' });
    }

    if (!allowSignup) {
      return res.status(403).json({ error: 'New signups are currently disabled.' });
    }

    if (!allowTrial) {
      return res.status(403).json({ error: 'Trial signup is currently disabled.' });
    }

    const adminEmail = String(req.body.adminEmail ?? '').trim().toLowerCase();
    const otp = String(req.body.otp ?? '').trim();
    const tagline = String(req.body.tagline ?? '').trim();
    const address = String(req.body.address ?? '').trim();
    const phone = String(req.body.phone ?? '').trim();

    if (!adminEmail || !otp) {
      return res.status(400).json({ 
        error: 'Missing required fields'
      });
    }

    // Verify OTP
    if (!(await verifySignupOtp(adminEmail, otp))) {
      return res.status(401).json({ 
        error: 'Invalid or expired verification code'
      });
    }

    const signupOtp = await getSignupOtp(adminEmail);

    if (!signupOtp) {
      return res.status(400).json({
        error: 'Signup verification data was not found. Please request a new code and try again.',
      });
    }

    // Create school
    const school = await prisma.school.create({
      data: {
        name: signupOtp.schoolName,
        slug: signupOtp.slug,
        tagline: tagline || null,
        address: address || null,
        phone: phone || null,
        country: signupOtp.country,
        email: adminEmail,
        status: 'TRIAL',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        name: signupOtp.adminName,
        role: 'SCHOOL_ADMIN',
        passwordHash: signupOtp.passwordHash,
        schoolId: school.id,
      },
    });

    // Mark OTP as verified in the database
    await prisma.signupOtp.update({
      where: { email: adminEmail },
      data: { verifiedAt: new Date() },
    }).catch((err) => {
      console.warn('Failed to update SignupOtp verification timestamp:', err);
      // Non-blocking - don't fail the signup if this update fails
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
      await sendWelcomeEmail(adminEmail, signupOtp.schoolName, signupOtp.adminName);
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
    const { schoolId, days = 7 } = req.body;

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
