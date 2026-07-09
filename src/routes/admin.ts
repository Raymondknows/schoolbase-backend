// @ts-nocheck
import { Router, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { sendPasswordResetEmail, sendFeeReminderEmail, sendAttendanceNotificationEmail, sendTeacherWelcomeEmail, sendAdmissionNotificationEmail, sendFeePaymentReceiptEmail, sendAnnouncementEmail, sendPlatformCommunicationEmail, sendSubscriptionPaymentSuccessEmail } from '../services/email.js';
import { CommunicationService, RulesEngine, TemplateEngine, RecipientResolver, DeliveryQueue, DriverManager, EmailDriver, WhatsAppDriver } from '../communications/index.js';
import baileysSessionManager from '../communications/whatsapp-baileys.js';
import { CommunicationRulesRegistry, DEFAULT_COMMUNICATION_RULES } from '../communications/rules.js';
import { ResultsDomainService } from '../domain/results/ResultsDomainService.js';
import requireActiveSubscription from '../middleware/subscriptionGuard.js';
import { checkSubscription, requireSubscription } from '../middleware/subscriptionGuard.js';
import type { NextFunction } from 'express';

const router = Router();
const prisma = new PrismaClient();
const resultsDomain = new ResultsDomainService(prisma);
const communicationRulesRegistry = new CommunicationRulesRegistry(DEFAULT_COMMUNICATION_RULES);

const sharedDriverManager = new DriverManager({
  EMAIL: new EmailDriver(async ({ recipient, request }) => {
    const metadata = { ...(request.metadata ?? {}), ...(request.data ?? {}) } as Record<string, unknown>;
    const studentName = String(metadata.studentName ?? 'Student');
    const className = String(metadata.className ?? 'Unknown Class');
    const termName = String(metadata.termName ?? 'Current Term');
    const amount = String(metadata.amount ?? '0.00');
    const paidAmount = String(metadata.paidAmount ?? '0.00');
    const outstanding = String(metadata.outstanding ?? '0.00');
    const schoolName = String(metadata.schoolName ?? 'School');
    const logoUrl = typeof metadata.logoUrl === 'string' ? metadata.logoUrl : undefined;

    if (request.event === 'AdmissionCreated') {
      await sendAdmissionNotificationEmail(
        recipient.address,
        recipient.name ?? 'Guardian',
        studentName,
        className,
        String(metadata.admissionNo ?? 'N/A'),
        schoolName,
        logoUrl,
      );
    } else if (request.event === 'FeePaymentReceived') {
      const currency = String(metadata.currency ?? metadata.schoolCurrency ?? 'NGN');
      await sendFeePaymentReceiptEmail(
        recipient.address,
        recipient.name ?? 'Guardian',
        studentName,
        className,
        currency,
        amount,
        paidAmount,
        outstanding,
        schoolName,
        logoUrl,
      );
    } else if (request.event === 'AnnouncementCreated') {
      await sendAnnouncementEmail(
        recipient.address,
        recipient.name ?? 'Guardian',
        String(metadata.title ?? request.subject ?? 'School Announcement'),
        String(metadata.message ?? request.body ?? ''),
        schoolName,
        logoUrl,
      );
    } else if (request.event === 'FeeInvoiceCreated') {
      await sendPlatformCommunicationEmail(
        recipient.address,
        recipient.name ?? 'Guardian',
        schoolName,
        'Fee Invoice',
        request.subject ?? 'Fee Invoice',
        request.body ?? '',
      );
    } else if (request.event === 'AttendanceMarked') {
      await sendAttendanceNotificationEmail(
        recipient.address,
        recipient.name ?? 'Guardian',
        studentName,
        className,
        String(metadata.date ?? ''),
        String(metadata.status ?? 'present') as 'present' | 'absent' | 'late',
        schoolName,
        String(metadata.customMessage ?? ''),
        logoUrl,
      );
    } else {
      const currency = String(metadata.currency ?? metadata.schoolCurrency ?? 'NGN');
      await sendFeeReminderEmail(
        recipient.address,
        recipient.name ?? 'Guardian',
        studentName,
        className,
        termName,
        currency,
        amount,
        paidAmount,
        outstanding,
        schoolName,
        logoUrl,
      );
    }

    return {
      channel: 'EMAIL',
      recipient: recipient.address,
      status: 'SENT',
      provider: 'email-service',
    } as const;
  }),
  WHATSAPP: new WhatsAppDriver(async ({ recipient, request, content }) => {
    const schoolId = request.schoolId ?? '';
    const result = await baileysSessionManager.sendTextMessage(schoolId, recipient.address, content.body) as { success: boolean; messageId?: string; error?: string };

    if (!result.success) {
      return {
        channel: 'WHATSAPP',
        recipient: recipient.address,
        status: 'FAILED',
        provider: 'baileys',
        error: result.error,
      } as const;
    }

    return {
      channel: 'WHATSAPP',
      recipient: recipient.address,
      status: 'SENT',
      provider: 'baileys',
      messageId: result.messageId,
    } as const;
  }),
});

const sharedDeliveryQueue = new DeliveryQueue(sharedDriverManager.send.bind(sharedDriverManager));

function createCommunicationService() {
  return new CommunicationService({
    rulesEngine: new RulesEngine(communicationRulesRegistry),
    templateEngine: new TemplateEngine(),
    recipientResolver: new RecipientResolver(),
    deliveryQueue: sharedDeliveryQueue,
    driverManager: sharedDriverManager,
  });
}

// Setup multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'photos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req: any, file: any, cb: any) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
});

const settingsUploadDir = path.join(process.cwd(), 'uploads', 'settings');
if (!fs.existsSync(settingsUploadDir)) {
  fs.mkdirSync(settingsUploadDir, { recursive: true });
}

const settingsStorage = multer.diskStorage({
  destination: settingsUploadDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const settingsUpload = multer({
  storage: settingsStorage,
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 },
});

function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ?? 'schoolbase-dev-secret-change-me',
  );
}

function normalizeField(value: any): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveSchoolId(req: Request) {
  // Check query parameter first
  const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string);
  if (schoolId) {
    console.log('[resolveSchoolId] Found schoolId in query/headers:', schoolId);
    return schoolId;
  }

  // Check request body
  const bodySchoolId = (req.body as any)?.schoolId;
  if (bodySchoolId) {
    console.log('[resolveSchoolId] Found schoolId in body:', bodySchoolId);
    return bodySchoolId;
  }

  // Check unified session cookie (supports both old and new names for backward compatibility)
  const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
  console.log('[resolveSchoolId] Checking cookies - schoolbase_session:', req.cookies?.schoolbase_session ? 'present' : 'missing', 
    ', all cookies:', Object.keys(req.cookies || {}));
  
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      console.log('[resolveSchoolId] JWT payload:', payload);
      if (payload && typeof payload === 'object' && 'schoolId' in payload) {
        const resolvedId = String((payload as any).schoolId);
        console.log('[resolveSchoolId] Resolved schoolId from token:', resolvedId);
        return resolvedId;
      }
    } catch (err) {
      console.error('[resolveSchoolId] JWT verification failed:', (err as Error).message);
    }
  }

  let slug: string | null = null;
  const signedSlug = req.cookies?.schoolSlug_v2;
  if (signedSlug) {
    try {
      const { payload } = await jwtVerify(signedSlug, secret());
      if (payload && typeof payload === 'object' && 'slug' in payload) {
        slug = String((payload as any).slug);
      }
    } catch {
      // ignore invalid signed slug
    }
  }

  if (!slug) {
    const legacySlug = req.cookies?.schoolSlug;
    if (legacySlug && /^[a-z0-9-]+$/.test(legacySlug)) {
      slug = legacySlug;
    }
  }

  if (slug) {
    console.log('[resolveSchoolId] Looking up school by slug:', slug);
    const school = await prisma.school.findUnique({ where: { slug } });
    console.log('[resolveSchoolId] Found school by slug:', school?.id);
    return school?.id ?? null;
  }

  console.log('[resolveSchoolId] No schoolId found anywhere');
  return null;
}

async function resolveUserName(req: Request): Promise<string | null> {
  const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload && typeof payload === 'object' && 'name' in payload) {
      return String((payload as any).name);
    }
  } catch (err) {
    console.error('[resolveUserName] JWT verification failed:', (err as Error).message);
  }

  return null;
}

// Apply subscription guard to school-scoped routes, excluding a small set of public endpoints
router.use((req: Request, res: Response, next: any) => {
  const allowlist = [
    '/verify',
    '/settings',
    '/settings/status',
    '/settings/data',
    '/logo/presign',
    '/school-logo',
    '/school-stamp',
    '/school-signature',
    '/school/',
    '/subscribe',
    '/subscription/status',
    '/request-password-reset',
    '/reset-password',
    '/paystack',
    '/platform',
  ];

  // Allow exact or prefix matches for the allowlist
  for (const prefix of allowlist) {
    if (req.path === prefix || req.path.startsWith(prefix + '/') || req.path.startsWith(prefix)) {
      return next();
    }
  }

  // Allow read-only results access for school admins even if subscription is inactive.
  // This keeps assessment pages visible while still protecting writes.
  if (req.method === 'GET' && req.path.startsWith('/results')) {
    return next();
  }

  return requireActiveSubscription(req as any, res as any, next);
});

function truncateNotificationBody(body: string, maxLength = 180) {
  if (!body) return body;
  return body.length <= maxLength ? body : `${body.slice(0, maxLength - 3)}...`;
}

// POST /api/admin/verify - Verify staff session from cookie
router.post('/verify', async (req: Request, res: Response) => {
  try {
    // Check for unified session cookie
    const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
    
    if (!token) {
      return res.status(401).json({ authenticated: false });
    }

    const { payload } = await jwtVerify(token, secret());
    
    // Add subscription status if school ID is available
    let subscriptionCheck = null;
    if ((payload as any).schoolId) {
      subscriptionCheck = await checkSubscription((payload as any).schoolId);
    }
    
    res.json({
      authenticated: true,
      session: payload,
      subscription: subscriptionCheck, // Added: subscription state (non-breaking)
    });
  } catch (error) {
    res.status(401).json({ authenticated: false });
  }
});

router.post('/impersonate', async (req: Request, res: Response) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      return res.status(400).json({ error: 'Impersonation token is required.' });
    }

    const { payload } = await jwtVerify(token, secret());
    const schoolId = String((payload as any).schoolId || '');
    const purpose = String((payload as any).purpose || '');
    const adminId = String((payload as any).adminId || 'platform-admin');

    if (!schoolId || purpose !== 'IMPERSONATION') {
      return res.status(400).json({ error: 'Invalid impersonation token.' });
    }

    const sessionToken = await new SignJWT({
      userId: adminId,
      role: 'SCHOOL_ADMIN',
      email: 'impersonation@schoolbase.local',
      name: 'Platform Admin Impersonator',
      schoolId,
      impersonation: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());

    res.json({
      success: true,
      token: sessionToken,
      schoolId,
    });
  } catch (error) {
    console.error('[API ADMIN] Impersonation exchange error:', error);
    return res.status(500).json({ error: 'Failed to exchange impersonation token.' });
  }
});

// POST /api/admin/login - DEPRECATED: Use /api/auth/platform-login or /api/auth/school-login
// This endpoint is kept for backward compatibility only
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        passwordHash: true,
        schoolId: true,
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // DEPRECATED: Add validation warnings
    console.warn(`[DEPRECATED] /api/admin/login called for ${user.role} (${email}). Use /api/auth/platform-login or /api/auth/school-login`);

    // For backward compatibility, still create token
    const token = await new SignJWT({
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      name: user.name,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());

    // Set unified httpOnly session cookie for all user types
    res.cookie('schoolbase_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      domain: process.env.NODE_ENV === 'production' ? '.schoolbase.live' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ 
      success: true, 
      token, // Include token so frontend can decode role
      role: user.role,
      userId: user.id,
      schoolId: user.schoolId,
      name: user.name,
      email: user.email
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/admin/school - Get logged-in admin's school data (multi-tenant safe)
router.get('/school', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      include: {
        partner: true,
        enabledPhases: true,
      },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json(school);
  } catch (error) {
    console.error('[GET /api/admin/school] Error:', error);
    res.status(500).json({ error: 'Failed to fetch school', details: String(error) });
  }
});

// GET /api/admin/school/:schoolId - Get school data by ID
router.get('/school/:schoolId', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;
    
    console.log('[GET /api/admin/school/:schoolId] schoolId:', schoolId);

    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      include: {
        partner: true,
        enabledPhases: true,
      },
    });

    console.log('[GET /api/admin/school/:schoolId] school:', school ? 'found' : 'not found');

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json(school);
  } catch (error) {
    console.error('[GET /api/admin/school/:schoolId] Error:', error);
    res.status(500).json({ error: 'Failed to fetch school', details: String(error) });
  }
});

// GET /api/admin/settings - Get school settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        initials: true,
        country: true,
        currency: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        logoUrl: true,
        primaryColor: true,
        principalName: true,
        principalComment: true,
        principalSignatureUrl: true,
        stampUrl: true,
        manualPaymentAccountName: true,
        manualPaymentAccountNumber: true,
        manualPaymentBankName: true,
        paystackPublicEncrypted: true,
        paystackSecretEncrypted: true,
      },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({
      config: {
        name: school.name,
        initials: school.initials,
        country: school.country,
        currency: school.currency,
        address: school.address,
        city: school.city,
        phone: school.phone,
        email: school.email,
        logoUrl: school.logoUrl,
        primaryColor: school.primaryColor,
        principalName: school.principalName,
        principalComment: school.principalComment,
        principalSignatureUrl: school.principalSignatureUrl,
        stampUrl: school.stampUrl,
        manualPaymentAccountName: school.manualPaymentAccountName,
        manualPaymentAccountNumber: school.manualPaymentAccountNumber,
        manualPaymentBankName: school.manualPaymentBankName,
        hasPaystackPublic: Boolean(school.paystackPublicEncrypted),
        hasPaystackSecret: Boolean(school.paystackSecretEncrypted),
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST /api/admin/settings - Save school settings
router.post('/settings', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const {
      name,
      initials,
      country,
      currency,
      address,
      principalName,
      principalComment,
      manualPaymentAccountName,
      manualPaymentAccountNumber,
      manualPaymentBankName,
      principalSignatureUrl,
      stampUrl,
      logoUrl,
      paystackPublic,
      paystackSecret,
    } = req.body;

    const school = await prisma.school.update({
      where: { id: schoolId },
      data: {
        name,
        initials,
        country,
        currency,
        address,
        principalName,
        principalComment,
        manualPaymentAccountName,
        manualPaymentAccountNumber,
        manualPaymentBankName,
        principalSignatureUrl,
        stampUrl,
        logoUrl,
        paystackPublicEncrypted: paystackPublic || null,
        paystackSecretEncrypted: paystackSecret || null,
      },
    });

    res.json({ success: true, school });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// GET /api/admin/settings/status - Get settings status
router.get('/settings/status', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        paystackPublicEncrypted: true,
        paystackSecretEncrypted: true,
        twilioSidEncrypted: true,
        twilioTokenEncrypted: true,
      },
    });

    res.json({
      paystack: {
        effective: school?.paystackPublicEncrypted && school?.paystackSecretEncrypted ? 'per-school' : null,
      },
      twilio: {
        effective: school?.twilioSidEncrypted && school?.twilioTokenEncrypted ? 'per-school' : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// GET /api/admin/settings/data - Get school settings and staff for authenticated school
router.get('/settings/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        initials: true,
        slug: true,
        address: true,
        city: true,
        country: true,
        currency: true,
        phone: true,
        email: true,
        logoUrl: true,
        primaryColor: true,
        principalName: true,
        principalComment: true,
        principalSignatureUrl: true,
        stampUrl: true,
        manualPaymentAccountName: true,
        manualPaymentAccountNumber: true,
        manualPaymentBankName: true,
        paystackPublicEncrypted: true,
        paystackSecretEncrypted: true,
        enabledPhases: true,
      },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const staff = await prisma.user.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    });

    res.json({
      config: {
        name: school.name,
        initials: school.initials,
        slug: school.slug,
        address: school.address,
        city: school.city,
        country: school.country,
        currency: school.currency,
        phone: school.phone,
        email: school.email,
        logoUrl: school.logoUrl,
        primaryColor: school.primaryColor,
        principalName: school.principalName,
        principalComment: school.principalComment,
        principalSignatureUrl: school.principalSignatureUrl,
        stampUrl: school.stampUrl,
        manualPaymentAccountName: school.manualPaymentAccountName,
        manualPaymentAccountNumber: school.manualPaymentAccountNumber,
        manualPaymentBankName: school.manualPaymentBankName,
        paystackPublicKey:
          process.env.PAYSTACK_SUBSCRIPTION_PUBLIC_KEY ||
          process.env.PAYSTACK_PUBLIC_KEY ||
          null,
        hasPaystackPublic: Boolean(school.paystackPublicEncrypted),
        hasPaystackSecret: Boolean(school.paystackSecretEncrypted),
        enabledPhases: school.enabledPhases,
      },
      staff,
    });
  } catch (error) {
    console.error('Error fetching settings data:', error);
    res.status(500).json({ error: 'Failed to fetch settings data' });
  }
});

// POST /api/admin/settings/upload - Upload school asset (signature, stamp, logo)
router.post('/settings/upload', settingsUpload.single('file'), async (req: Request, res: Response) => {
  console.log('[settings upload] contentType=', req.headers['content-type']);
  console.log('[settings upload] body=', req.body);
  console.log('[settings upload] file=', req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path,
  } : null);

  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const fileType = (req.body.type || req.query.type) as string;

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const assetUrl = `/uploads/settings/${req.file.filename}`;
    
    // Update school record with the new asset URL
    const updateData: any = {};
    if (fileType === 'signature') {
      updateData.principalSignatureUrl = assetUrl;
    } else if (fileType === 'stamp') {
      updateData.stampUrl = assetUrl;
    } else if (fileType === 'logo') {
      updateData.logoUrl = assetUrl;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.school.update({
        where: { id: schoolId },
        data: updateData,
      });
    }

    res.json({
      success: true,
      message: 'File uploaded successfully',
      url: assetUrl,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// GET /api/admin/school-logo/:schoolId - Redirect to school logo asset
router.get('/school-logo/:schoolId', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { logoUrl: true },
    });

    if (!school || !school.logoUrl) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    return res.redirect(307, school.logoUrl);
  } catch (error) {
    console.error('Error fetching school logo:', error);
    res.status(500).json({ error: 'Failed to fetch school logo' });
  }
});

// GET /api/admin/school-stamp/:schoolId - Redirect to school stamp asset
router.get('/school-stamp/:schoolId', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { stampUrl: true },
    });

    if (!school || !school.stampUrl) {
      return res.status(404).json({ error: 'School stamp not found' });
    }

    return res.redirect(307, school.stampUrl);
  } catch (error) {
    console.error('Error fetching school stamp:', error);
    res.status(500).json({ error: 'Failed to fetch school stamp' });
  }
});

// GET /api/admin/school-signature/:schoolId - Redirect to principal signature asset
router.get('/school-signature/:schoolId', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { principalSignatureUrl: true },
    });

    if (!school || !school.principalSignatureUrl) {
      return res.status(404).json({ error: 'Signature not found' });
    }

    return res.redirect(307, school.principalSignatureUrl);
  } catch (error) {
    console.error('Error fetching school signature:', error);
    res.status(500).json({ error: 'Failed to fetch school signature' });
  }
});

// POST /api/admin/logo/presign - Get local upload URL for logo upload
router.post('/logo/presign', async (req: Request, res: Response) => {
  try {
    const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string);
    const { fileName, contentType, fileSize } = req.body;

    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    if (!fileName) {
      return res.status(400).json({ error: 'File name is required' });
    }

    res.json({
      success: true,
      type: 'local',
      uploadUrl: `/api/admin/settings/upload?schoolId=${schoolId}&type=logo`,
      fileName,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

// POST /api/admin/logo/confirm - Confirm logo upload
router.post('/logo/confirm', async (req: Request, res: Response) => {
  try {
    const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string);
    const { key, url } = req.body;

    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    res.json({
      success: true,
      message: 'Logo confirmed',
      url: url || key,
    });
  } catch (error) {
    console.error('Error confirming logo:', error);
    res.status(500).json({ error: 'Failed to confirm logo' });
  }
});

// POST /api/admin/students/:pupilId/photo - Upload student photo
router.post('/students/:pupilId/photo', upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const { pupilId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Verify the pupil exists
    const pupil = await prisma.pupil.findUnique({
      where: { id: pupilId },
    });

    if (!pupil) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Student not found' });
    }

    // Update pupil with photo URL
    const photoUrl = `/uploads/photos/${req.file.filename}`;
    await prisma.pupil.update({
      where: { id: pupilId },
      data: { photoUrl },
    });

    res.json({
      success: true,
      photoUrl,
      message: 'Student photo uploaded successfully',
    });
  } catch (error) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading student photo:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// GET /api/admin/dashboard - Get dashboard stats for client-side rendering
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    console.log('[GET /api/admin/dashboard] schoolId:', schoolId);

    const [invoices, pupilCount, classCount, readyAssessment, recentPayments, recentPupils, recentTeachers, recentAnnouncements] =
      await Promise.all([
        prisma.invoice.findMany({
          where: { schoolId },
          select: { amountDue: true, amountPaid: true, status: true },
        }),
        prisma.pupil.count({ where: { schoolId, isActive: true } }),
        prisma.class.count({ where: { schoolId } }),
        prisma.assessment.findFirst({
          where: { schoolId, status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.payment.findMany({
          take: 3,
          orderBy: { paidAt: 'desc' },
          include: { invoice: { include: { pupil: true } } },
          where: { invoice: { schoolId } },
        }),
        prisma.pupil.findMany({
          where: { schoolId, isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: { class: { select: { name: true, arm: true } } },
        }),
        prisma.user.findMany({
          where: { schoolId, role: 'TEACHER' },
          orderBy: { createdAt: 'desc' },
          take: 3,
        }),
        prisma.announcement.findMany({
          where: { schoolId },
          orderBy: { publishedAt: 'desc' },
          take: 3,
        }),
      ]);

    const outstanding = invoices.reduce(
      (sum, inv) => sum + Math.max(0, inv.amountDue - inv.amountPaid),
      0,
    );
    const attentionCount = invoices.filter((i) =>
      ['SENT', 'PART_PAID', 'OVERDUE'].includes(i.status),
    ).length;

    console.log('[GET /api/admin/dashboard] invoices.length:', invoices.length, 'outstanding:', outstanding);

    res.json({
      invoices: invoices.map(inv => ({
        amountDue: inv.amountDue,
        amountPaid: inv.amountPaid,
        status: inv.status,
      })),
      pupilCount,
      classCount,
      readyAssessment,
      recentPayments,
      recentPupils,
      recentTeachers,
      recentAnnouncements,
      outstanding,
      attentionCount,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/admin/fees/data - Get fees page data
router.get('/fees/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { currency: true },
    });

    const currentAcademicYear = await prisma.academicYear.findFirst({
      where: { schoolId, isCurrent: true },
      orderBy: { createdAt: 'desc' },
    });

    const terms = currentAcademicYear
      ? await prisma.term.findMany({
          where: { academicYearId: currentAcademicYear.id },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    const invoices = await prisma.invoice.findMany({
      where: { schoolId },
      include: {
        pupil: { include: { class: true, guardians: { include: { guardian: true } } } },
        payments: { orderBy: { paidAt: 'desc' }, take: 1 },
        feeSchedule: { include: { term: { include: { academicYear: true } } } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });

    const outstanding = invoices.reduce(
      (s, i) => s + Math.max(0, i.amountDue - i.amountPaid),
      0,
    );

    const mappedInvoices = invoices.map((inv) => ({
      ...inv,
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
      academicYear: inv.feeSchedule?.term?.academicYear
        ? {
            id: inv.feeSchedule.term.academicYear.id,
            name: inv.feeSchedule.term.academicYear.name,
            isCurrent: inv.feeSchedule.term.academicYear.isCurrent,
          }
        : null,
    }));

    res.json({
      invoices: mappedInvoices,
      outstanding,
      currency: school?.currency || 'NGN',
      terms,
    });
  } catch (error) {
    console.error('Error fetching fees data:', error);
    res.status(500).json({ error: 'Failed to fetch fees data' });
  }
});

// GET /api/admin/fees/schedules - Get all fee schedules for school
router.get('/fees/schedules', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const feeSchedules = await prisma.feeSchedule.findMany({
      where: { schoolId },
      include: {
        term: { include: { academicYear: true } },
        class: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { currency: true },
    });

    const terms = await prisma.term.findMany({
      where: { academicYear: { schoolId } },
      include: { academicYear: true },
      orderBy: [{ academicYear: { createdAt: 'desc' } }, { sortOrder: 'asc' }],
    });

    const classes = await prisma.class.findMany({
      where: { schoolId },
      select: { id: true, name: true, arm: true, phase: true },
      orderBy: { name: 'asc' },
    });

    res.json({
      feeSchedules,
      currency: school?.currency || 'NGN',
      terms,
      classes,
    });
  } catch (error) {
    console.error('Error fetching fee schedules:', error);
    res.status(500).json({ error: 'Failed to fetch fee schedules' });
  }
});

// POST /api/admin/fees/schedules - Create fee schedule
router.post('/fees/schedules', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { termId, classId, name, amount } = req.body;

    if (!termId || !name || amount === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: termId, name, amount',
      });
    }

    // Verify term belongs to school
    const term = await prisma.term.findFirst({
      where: { id: termId, academicYear: { schoolId } },
    });

    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }

    // Verify class belongs to school if provided
    if (classId) {
      const classExists = await prisma.class.findFirst({
        where: { id: classId, schoolId },
      });

      if (!classExists) {
        return res.status(404).json({ error: 'Class not found' });
      }
    }

    const feeSchedule = await prisma.feeSchedule.create({
      data: {
        schoolId,
        termId,
        classId: classId || null,
        name,
        amount: Math.round(parseFloat(amount) * 100), // Convert to cents
      },
      include: {
        term: { include: { academicYear: true } },
        class: true,
      },
    });

    res.json({ success: true, feeSchedule });
  } catch (error) {
    console.error('Error creating fee schedule:', error);
    res.status(500).json({ error: 'Failed to create fee schedule' });
  }
});

// PATCH /api/admin/fees/schedules/:id - Update fee schedule
router.patch('/fees/schedules/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { termId, classId, name, amount } = req.body;

    // Verify fee schedule belongs to school
    const feeSchedule = await prisma.feeSchedule.findFirst({
      where: { id, schoolId },
    });

    if (!feeSchedule) {
      return res.status(404).json({ error: 'Fee schedule not found' });
    }

    const updateData: any = {};

    if (name !== undefined) updateData.name = name;

    if (amount !== undefined) {
      updateData.amount = Math.round(parseFloat(amount) * 100); // Convert to cents
    }

    if (termId !== undefined) {
      // Verify term belongs to school
      const term = await prisma.term.findFirst({
        where: { id: termId, academicYear: { schoolId } },
      });

      if (!term) {
        return res.status(404).json({ error: 'Term not found' });
      }

      updateData.termId = termId;
    }

    if (classId !== undefined) {
      if (classId) {
        // Verify class belongs to school
        const classExists = await prisma.class.findFirst({
          where: { id: classId, schoolId },
        });

        if (!classExists) {
          return res.status(404).json({ error: 'Class not found' });
        }
      }

      updateData.classId = classId || null;
    }

    const updated = await prisma.feeSchedule.update({
      where: { id },
      data: updateData,
      include: {
        term: { include: { academicYear: true } },
        class: true,
      },
    });

    res.json({ success: true, feeSchedule: updated });
  } catch (error) {
    console.error('Error updating fee schedule:', error);
    res.status(500).json({ error: 'Failed to update fee schedule' });
  }
});

// DELETE /api/admin/fees/schedules/:id - Delete fee schedule
router.delete('/fees/schedules/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Verify fee schedule belongs to school
    const feeSchedule = await prisma.feeSchedule.findFirst({
      where: { id, schoolId },
    });

    if (!feeSchedule) {
      return res.status(404).json({ error: 'Fee schedule not found' });
    }

    // Check if schedule has invoices
    const invoiceCount = await prisma.invoice.count({
      where: { feeScheduleId: id },
    });

    if (invoiceCount > 0) {
      return res.status(400).json({
        error: `Cannot delete fee schedule with ${invoiceCount} invoice(s). Delete invoices first.`,
      });
    }

    await prisma.feeSchedule.delete({ where: { id } });

    res.json({ success: true, message: 'Fee schedule deleted' });
  } catch (error) {
    console.error('Error deleting fee schedule:', error);
    res.status(500).json({ error: 'Failed to delete fee schedule' });
  }
});

// POST /api/admin/fees/invoices/issue-bills - Create invoices for a term
router.post('/fees/invoices/issue-bills', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const requestCurrency = (req.body && req.body.currency) ? String(req.body.currency).trim() : undefined;

    const { termId } = req.body;
    if (!termId) {
      return res.status(400).json({ error: 'Term ID required' });
    }

    // Get all fee schedules for this term
    const feeSchedules = await prisma.feeSchedule.findMany({
      where: { termId, schoolId },
      include: { 
        class: true,
        term: true,
      },
    });

    if (feeSchedules.length === 0) {
      return res.status(400).json({ error: 'No fee schedules found for this term' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, logoUrl: true, currency: true },
    });

    const communicationService = createCommunicationService();
    let createdCount = 0;
    let notificationsCount = 0;
    const errors: string[] = [];

    // For each fee schedule, create invoices for eligible pupils
    for (const schedule of feeSchedules) {
      let eligiblePupils: any[];

      if (schedule.classId) {
        // Schedule is for specific class
        eligiblePupils = await prisma.pupil.findMany({
          where: { classId: schedule.classId, isActive: true },
          include: { 
            guardians: { include: { guardian: true } },
            class: true,
          },
        });
      } else {
        // Schedule is for all pupils in school
        eligiblePupils = await prisma.pupil.findMany({
          where: { schoolId, isActive: true },
          include: { 
            guardians: { include: { guardian: true } },
            class: true,
          },
        });
      }

      // Create invoices for each pupil (skip if already exists)
      for (const pupil of eligiblePupils) {
        try {
          // Check if invoice already exists
          const existingInvoice = await prisma.invoice.findFirst({
            where: {
              pupilId: pupil.id,
              feeScheduleId: schedule.id,
            },
          });

          if (existingInvoice) {
            continue; // Skip if already exists
          }

          // Generate unique invoice number
          const invoiceNo = `INV-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

          // Create invoice
          const invoice = await prisma.invoice.create({
            data: {
              schoolId,
              pupilId: pupil.id,
              feeScheduleId: schedule.id,
              invoiceNo,
              amountDue: schedule.amount,
              status: 'SENT', // Mark as sent when created
              dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            },
          });

          createdCount++;

          // Send notifications to guardians via both channels
          const pupilName = `${pupil.firstName} ${pupil.lastName}`;
          const className = pupil.class?.name || 'Unknown Class';
          const amount = (schedule.amount / 100).toFixed(2);

          for (const guardianPupil of pupil.guardians) {
            const guardian = guardianPupil.guardian;
            const scheduleCurrency = requestCurrency || school?.currency || 'NGN';
            const message = `Dear ${guardian.firstName}, this is to inform you that an invoice for ${school?.name || 'School'} fees has been issued for ${pupilName} (${className}). Amount: ${scheduleCurrency} ${amount}. Please contact the school for payment details.`;
            const whatsappAddress = guardian.whatsapp || guardian.phone;

            const recipients = [
              ...(whatsappAddress ? [{ channel: 'WHATSAPP' as const, address: whatsappAddress, name: guardian.firstName }] : []),
              ...(guardian.email ? [{ channel: 'EMAIL' as const, address: guardian.email, name: guardian.firstName }] : []),
            ];

            if (recipients.length > 0) {
              try {
                const dispatchResult = await communicationService.dispatch({
                  event: 'FeeInvoiceCreated',
                  schoolId,
                  recipients,
                  template: 'Invoice',
                  body: message,
                  subject: 'Fee Invoice Issued',
                  data: {
                    studentName: pupilName,
                    className,
                    amount,
                    currency: scheduleCurrency,
                    balance: amount,
                    schoolName: school?.name || 'School',
                    recipientName: guardian.firstName,
                  },
                  metadata: {
                    studentName: pupilName,
                    className,
                    amount,
                    currency: scheduleCurrency,
                    balance: amount,
                    schoolName: school?.name || 'School',
                    termName: schedule.term?.name || 'Current Term',
                    paidAmount: '0.00',
                    outstanding: amount,
                    logoUrl: school?.logoUrl ?? undefined,
                    invoiceId: invoice.id,
                    invoiceNo,
                    guardianId: guardian.id,
                  },
                });

                for (const delivery of dispatchResult.deliveries) {
                  const status = delivery.status === 'SENT' ? 'SENT' : delivery.status === 'QUEUED' ? 'PENDING' : 'FAILED';
                  await prisma.notification.create({
                    data: {
                      schoolId,
                      guardianId: guardian.id,
                      type: 'ISSUE_BILLS',
                      title: 'Fee Invoice Issued',
                      body: truncateNotificationBody(message),
                      channel: delivery.channel,
                      status,
                      sentAt: delivery.status === 'SENT' || delivery.status === 'QUEUED' ? new Date() : undefined,
                      failureReason: delivery.error,
                      relatedId: invoice.id,
                      reference: invoiceNo,
                    },
                  });

                  if (status !== 'FAILED') {
                    notificationsCount++;
                  }
                }
              } catch (err) {
                errors.push(`Failed to dispatch communication for guardian ${guardian.id}`);
                await prisma.notification.create({
                  data: {
                    schoolId,
                    guardianId: guardian.id,
                    type: 'ISSUE_BILLS',
                    title: 'Fee Invoice Issued',
                    body: truncateNotificationBody(message),
                    channel: 'WHATSAPP',
                    status: 'FAILED',
                    failureReason: err instanceof Error ? err.message : String(err),
                    relatedId: invoice.id,
                    reference: invoiceNo,
                  },
                });
              }
            }
          }
        } catch (err) {
          errors.push(`Failed to create invoice for pupil ${pupil.id}: ${err}`);
        }
      }
    }

    res.json({
      success: true,
      message: `Created ${createdCount} invoices for term`,
      created: createdCount,
      notificationsSent: notificationsCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error issuing bills:', error);
    res.status(500).json({ error: 'Failed to issue bills' });
  }
});

// POST /api/admin/fees/invoices/send-reminders - Send reminders for outstanding invoices
router.post('/fees/invoices/send-reminders', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { invoiceId } = req.body || {};
    const requestCurrency = (req.body && req.body.currency) ? String(req.body.currency).trim() : undefined;

    // Find invoices that may need reminders: sent, part-paid, or overdue
    const invoices = invoiceId
      ? await prisma.invoice.findMany({
          where: {
            schoolId,
            id: invoiceId,
            status: { in: ['SENT', 'OVERDUE', 'PART_PAID'] },
          },
          include: {
            pupil: {
              include: {
                guardians: { include: { guardian: true } },
                class: true,
              },
            },
            feeSchedule: { include: { term: true } },
          },
        })
      : await prisma.invoice.findMany({
          where: {
            schoolId,
            status: { in: ['SENT', 'OVERDUE', 'PART_PAID'] },
          },
          include: {
            pupil: {
              include: {
                guardians: { include: { guardian: true } },
                class: true,
              },
            },
            feeSchedule: { include: { term: true } },
          },
        });

    if (invoiceId && invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        logoUrl: true,
        currency: true,
      },
    });

    const communicationService = createCommunicationService();

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    let sentCount = 0;
    let skippedCount = 0;
    let processedGuardians = 0;
    const errors: string[] = [];

    // Send reminders to guardians
    for (const invoice of invoices) {
      const pupilName = `${invoice.pupil.firstName} ${invoice.pupil.lastName}`;
      const className = invoice.pupil.class?.name || 'Unknown Class';
      const amount = (invoice.amountDue / 100).toFixed(2);
      const outstanding = Math.max(0, invoice.amountDue - invoice.amountPaid) / 100;

      if (outstanding <= 0) {
        continue;
      }

      for (const guardianPupil of invoice.pupil.guardians) {
        processedGuardians++;
        const guardian = guardianPupil.guardian;
        const currency = requestCurrency || school.currency || 'NGN';
        const cookiePresent = Boolean(req.cookies && req.cookies.country_v1);
        console.log(`[send-reminders] invoice=${invoice.id} guardian=${guardian.id} requestCurrency=${requestCurrency || '<none>'} cookiePresent=${cookiePresent} schoolCurrency=${school.currency || '<none>'} chosenCurrency=${currency}`);
        const message = `Dear ${guardian.firstName}, this is a reminder that fee payment of ${currency} ${amount} for ${pupilName} (${className}) is outstanding. Amount due: ${currency} ${outstanding.toFixed(2)}. Please make payment at your earliest convenience. Thank you.`;
        const whatsappAddress = guardian.whatsapp || guardian.phone;
        const canSendWhatsApp = Boolean(whatsappAddress);
        const canSendEmail = Boolean(guardian.email);

        if (!canSendWhatsApp && !canSendEmail) {
          skippedCount++;
          continue;
        }

        const recipients = [
          ...(canSendWhatsApp ? [{ channel: 'WHATSAPP' as const, address: whatsappAddress!, name: guardian.firstName }] : []),
          ...(guardian.email ? [{ channel: 'EMAIL' as const, address: guardian.email, name: guardian.firstName }] : []),
        ];

        if (recipients.length > 0) {
          try {
            const dispatchResult = await communicationService.dispatch({
              event: 'FeeReminder',
              schoolId,
              recipients,
              template: 'FeeReminder',
              body: message,
              subject: 'Fee Payment Reminder',
              data: {
                studentName: pupilName,
                className,
                amount,
                currency,
                balance: outstanding.toFixed(2),
                schoolName: school.name,
                recipientName: guardian.firstName,
              },
              metadata: {
                studentName: pupilName,
                className,
                amount,
                currency,
                balance: outstanding.toFixed(2),
                schoolName: school.name,
                termName: invoice.feeSchedule?.term?.name || 'Current Term',
                paidAmount: (invoice.amountPaid / 100).toFixed(2),
                outstanding: outstanding.toFixed(2),
                logoUrl: school.logoUrl ?? undefined,
                invoiceId: invoice.id,
                invoiceNo: invoice.invoiceNo,
                guardianId: guardian.id,
              },
            });

            for (const delivery of dispatchResult.deliveries) {
              const status = delivery.status === 'SENT' ? 'SENT' : delivery.status === 'QUEUED' ? 'PENDING' : 'FAILED';
              await prisma.notification.create({
                data: {
                  schoolId,
                  guardianId: guardian.id,
                  type: 'SEND_REMINDER',
                  title: 'Fee Payment Reminder',
                  body: truncateNotificationBody(message),
                  channel: delivery.channel,
                  status,
                  sentAt: delivery.status === 'SENT' || delivery.status === 'QUEUED' ? new Date() : undefined,
                  failureReason: delivery.error,
                  relatedId: invoice.id,
                  reference: invoice.invoiceNo,
                },
              });

              if (status !== 'FAILED') {
                sentCount++;
              }
            }
          } catch (err) {
            errors.push(`Failed to dispatch reminder communication for guardian ${guardian.id}`);
            await prisma.notification.create({
              data: {
                schoolId,
                guardianId: guardian.id,
                type: 'SEND_REMINDER',
                title: 'Fee Payment Reminder',
                body: truncateNotificationBody(message),
                channel: 'WHATSAPP',
                status: 'FAILED',
                failureReason: err instanceof Error ? err.message : String(err),
                relatedId: invoice.id,
                reference: invoice.invoiceNo,
              },
            });
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Sent ${sentCount} reminders`,
      sent: sentCount,
      skipped: skippedCount,
      totalInvoices: invoices.length,
      totalGuardians: processedGuardians,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error sending reminders:', error);
    res.status(500).json({ error: message || 'Failed to send reminders' });
  }
});

// GET /api/admin/invoices/:id - Get invoice details with all related data
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Fetch invoice with all related data
    const invoice = await prisma.invoice.findFirst({
      where: { id, schoolId },
      include: {
        pupil: {
          include: {
            class: true,
            guardians: { include: { guardian: true } },
          },
        },
        feeSchedule: {
          include: {
            term: { include: { academicYear: true } },
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Fetch school details for invoice
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        currency: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        logoUrl: true,
        principalName: true,
        principalSignatureUrl: true,
        stampUrl: true,
        manualPaymentAccountName: true,
        manualPaymentAccountNumber: true,
        manualPaymentBankName: true,
      },
    });

    // Map invoice data
    const mappedInvoice = {
      ...invoice,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      payments: invoice.payments.map((p) => ({
        ...p,
        paidAt: p.paidAt.toISOString(),
      })),
    };

    res.json({
      invoice: mappedInvoice,
      school,
      outstanding: Math.max(0, invoice.amountDue - invoice.amountPaid),
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// GET /api/admin/invoices/:id/pdf - Download invoice as PDF
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Fetch invoice with all related data
    const invoice = await prisma.invoice.findFirst({
      where: { id, schoolId },
      include: {
        pupil: {
          include: {
            class: true,
            guardians: { include: { guardian: true } },
          },
        },
        feeSchedule: {
          include: {
            term: { include: { academicYear: true } },
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Fetch school details
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        currency: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        logoUrl: true,
        principalName: true,
        principalSignatureUrl: true,
        stampUrl: true,
        manualPaymentAccountName: true,
        manualPaymentAccountNumber: true,
        manualPaymentBankName: true,
      },
    });

    // Format currency
    const formatAmount = (amount: number, currency: string) => {
      return `${currency} ${(amount / 100).toFixed(2)}`;
    };

    // Generate HTML invoice
    const pupilName = `${invoice.pupil.firstName} ${invoice.pupil.lastName}`;
    const className = invoice.pupil.class
      ? `${invoice.pupil.class.name}${invoice.pupil.class.arm ? ` ${invoice.pupil.class.arm}` : ""}`
      : "Unassigned";
    const termName = invoice.feeSchedule?.term?.name || "Unknown Term";
    const academicYear = invoice.feeSchedule?.term?.academicYear?.name || "";
    const currency = school?.currency || "NGN";
    const outstanding = Math.max(0, invoice.amountDue - invoice.amountPaid);

    const paymentRows = invoice.payments
      .map(
        (p) => `
        <tr>
          <td>${new Date(p.paidAt).toLocaleDateString()}</td>
          <td>${p.method.replace(/_/g, " ")}</td>
          <td>${p.reference || "—"}</td>
          <td style="text-align: right;">${formatAmount(p.amount, currency)}</td>
        </tr>
      `
      )
      .join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
          .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #ddd; padding-bottom: 20px; }
          .school-info h2 { font-size: 24px; margin-bottom: 10px; }
          .school-info p { font-size: 12px; color: #666; }
          .invoice-meta { text-align: right; }
          .invoice-meta p { font-size: 13px; margin: 5px 0; }
          .bill-to { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
          .bill-to-section h4 { font-size: 11px; text-transform: uppercase; color: #999; margin-bottom: 5px; font-weight: bold; }
          .bill-to-section p { margin: 3px 0; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          thead { background: #f5f5f5; }
          th { padding: 10px; text-align: left; font-weight: bold; font-size: 13px; border-bottom: 2px solid #ddd; }
          td { padding: 10px; font-size: 13px; border-bottom: 1px solid #eee; }
          .summary-table { width: 100%; margin-bottom: 30px; }
          .summary-table td { padding: 8px 10px; font-size: 13px; }
          .summary-table .label { text-align: right; padding-right: 20px; font-weight: bold; }
          .summary-table .amount { text-align: right; font-weight: bold; }
          .outstanding { color: #d32f2f; }
          .paid { color: #388e3c; }
          .payment-instructions { background: #e3f2fd; padding: 15px; border-radius: 4px; margin-bottom: 20px; font-size: 13px; }
          .payment-instructions h4 { font-weight: bold; margin-bottom: 8px; }
          .payment-instructions p { margin: 4px 0; }
          .footer { text-align: center; font-size: 11px; color: #999; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px; }
          .status-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 11px; }
          .status-paid { background: #c8e6c9; color: #1b5e20; }
          .status-overdue { background: #ffcdd2; color: #b71c1c; }
          .status-part-paid { background: #fff3e0; color: #e65100; }
          .status-draft { background: #f5f5f5; color: #424242; }
          @media print {
            body { margin: 0; padding: 0; }
            .container { padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header -->
          <div class="header">
            <div class="school-info">
              <h2>${school?.name || "School"}</h2>
              ${school?.address ? `<p>${school.address}${school.city ? `, ${school.city}` : ""}</p>` : ""}
              ${school?.email ? `<p>${school.email}</p>` : ""}
              ${school?.phone ? `<p>${school.phone}</p>` : ""}
            </div>
            <div class="invoice-meta">
              <div>
                <p><strong>Invoice #:</strong> ${invoice.invoiceNo}</p>
                <p><strong>Date:</strong> ${new Date(invoice.createdAt).toLocaleDateString()}</p>
                ${invoice.dueDate ? `<p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>` : ""}
                <p style="margin-top: 10px;"><span class="status-badge status-${invoice.status.toLowerCase().replace("_", "-")}">${invoice.status}</span></p>
              </div>
            </div>
          </div>

          <!-- Bill To -->
          <div class="bill-to">
            <div class="bill-to-section">
              <h4>Bill To</h4>
              <p><strong>${pupilName}</strong></p>
              <p>${className}</p>
              <p>${termName}, ${academicYear}</p>
            </div>
          </div>

          <!-- Invoice Details -->
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${invoice.feeSchedule?.name || "Fee"}</td>
                <td style="text-align: right;">${formatAmount(invoice.amountDue, currency)}</td>
              </tr>
            </tbody>
          </table>

          <!-- Summary -->
          <table class="summary-table">
            <tr>
              <td class="label">Amount Due:</td>
              <td class="amount">${formatAmount(invoice.amountDue, currency)}</td>
            </tr>
            <tr>
              <td class="label">Amount Paid:</td>
              <td class="amount paid">${formatAmount(invoice.amountPaid, currency)}</td>
            </tr>
            ${outstanding > 0 ? `<tr>
              <td class="label">Outstanding Balance:</td>
              <td class="amount outstanding">${formatAmount(outstanding, currency)}</td>
            </tr>` : ""}
          </table>

          <!-- Payment History -->
          ${invoice.payments.length > 0 ? `
            <h4 style="margin-bottom: 15px;">Payment History</h4>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th style="text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${paymentRows}
              </tbody>
            </table>
          ` : ""}

          <!-- Payment Instructions -->
          ${outstanding > 0 && school && (school.manualPaymentAccountName || school.manualPaymentAccountNumber) ? `
            <div class="payment-instructions">
              <h4>Payment Instructions</h4>
              ${school.manualPaymentAccountName ? `<p><strong>Account Name:</strong> ${school.manualPaymentAccountName}</p>` : ""}
              ${school.manualPaymentAccountNumber ? `<p><strong>Account Number:</strong> ${school.manualPaymentAccountNumber}</p>` : ""}
              ${school.manualPaymentBankName ? `<p><strong>Bank:</strong> ${school.manualPaymentBankName}</p>` : ""}
            </div>
          ` : ""}

          <!-- Footer -->
          <div class="footer">
            <p>This is an automated invoice generated by SchoolBase</p>
            <p>Please retain for your records</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Set response headers for PDF download
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoiceNo}.html"`);
    res.send(htmlContent);
  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
});

// POST /api/admin/fees/payments/record - Record a payment against an invoice
router.post('/fees/payments/record', requireSubscription, async (req: Request, res: Response) => {
  try {
    console.log('[/fees/payments/record] Request received');
    console.log('[/fees/payments/record] Cookies:', Object.keys(req.cookies || {}));
    console.log('[/fees/payments/record] Body:', req.body);
    
    const schoolId = await resolveSchoolId(req);
    console.log('[/fees/payments/record] Resolved schoolId:', schoolId);
    
    if (!schoolId) {
      console.error('[/fees/payments/record] No schoolId resolved');
      return res.status(400).json({ error: 'School ID required' });
    }

    const { invoiceId, amount, method, reference } = req.body;

    // Validate required fields
    if (!invoiceId || !amount || !method) {
      return res.status(400).json({ error: 'Invoice ID, amount, and payment method are required' });
    }

    // Fetch the invoice
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, schoolId },
      include: {
        pupil: {
          include: {
            class: true,
            guardians: { include: { guardian: true } },
          },
        },
      },
    });

    if (!invoice || !invoice.pupil) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Convert amount from string to integer (amount * 100 for cents)
    const amountInCents = Math.round(parseFloat(amount as any) * 100);

    if (amountInCents <= 0) {
      return res.status(400).json({ error: 'Payment amount must be greater than 0' });
    }

    // Check if payment exceeds outstanding balance
    const outstanding = invoice.amountDue - invoice.amountPaid;
    if (amountInCents > outstanding) {
      return res.status(400).json({ error: `Payment amount cannot exceed outstanding balance of ${(outstanding / 100).toFixed(2)}` });
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        invoiceId,
        amount: amountInCents,
        method,
        reference: reference || null,
      },
    });

    // Update invoice amountPaid and status
    const newAmountPaid = invoice.amountPaid + amountInCents;
    const newStatus = newAmountPaid >= invoice.amountDue ? 'PAID' : 'PART_PAID';

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: newAmountPaid,
        status: newStatus,
      },
    });

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, currency: true, logoUrl: true },
    });
    const communicationService = createCommunicationService();
    const guardians = invoice.pupil.guardians || [];
    const pupilName = `${invoice.pupil.firstName} ${invoice.pupil.lastName}`;
    const className = invoice.pupil.class?.name || 'Unknown Class';
    const amountPaidFormatted = (amountInCents / 100).toFixed(2);
    const newPaidAmountFormatted = (newAmountPaid / 100).toFixed(2);
    const balanceAmount = Math.max(0, updatedInvoice.amountDue - updatedInvoice.amountPaid) / 100;
    const balance = balanceAmount.toFixed(2);
    const paymentCurrency = school?.currency || 'NGN';
    const paymentMessage = `Dear guardian, we have received payment of ${paymentCurrency} ${amountPaidFormatted} for ${pupilName} (${className}). Your updated balance is ${paymentCurrency} ${balance}. Thank you.`;

    for (const guardianPupil of guardians) {
      const guardian = guardianPupil.guardian;
      const whatsappAddress = guardian.whatsapp || guardian.phone;
      const recipients = [
        ...(guardian.email ? [{ channel: 'EMAIL' as const, address: guardian.email, name: guardian.firstName }] : []),
        ...(whatsappAddress ? [{ channel: 'WHATSAPP' as const, address: whatsappAddress, name: guardian.firstName }] : []),
      ];

      if (recipients.length === 0) {
        continue;
      }

      try {
        const dispatchResult = await communicationService.dispatch({
          event: 'FeePaymentReceived',
          schoolId,
          recipients,
          template: 'Receipt',
          subject: 'Payment Received',
          body: paymentMessage,
          data: {
            studentName: pupilName,
            className,
            amount: amountPaidFormatted,
            currency: paymentCurrency,
            paidAmount: newPaidAmountFormatted,
            balance,
            schoolName: school?.name || 'SchoolBase',
            recipientName: guardian.firstName,
          },
          metadata: {
            studentName: pupilName,
            className,
            amount: amountPaidFormatted,
            currency: paymentCurrency,
            paidAmount: newPaidAmountFormatted,
            outstanding: balance,
            schoolName: school?.name || 'SchoolBase',
            logoUrl: school?.logoUrl ?? undefined,
            invoiceId: updatedInvoice.id,
            paymentId: payment.id,
            guardianId: guardian.id,
          },
        });

        for (const delivery of dispatchResult.deliveries) {
          const status = delivery.status === 'SENT' ? 'SENT' : delivery.status === 'QUEUED' ? 'PENDING' : 'FAILED';
          await prisma.notification.create({
            data: {
              schoolId,
              guardianId: guardian.id,
              type: 'RECEIPT',
              title: 'Payment Receipt',
              body: truncateNotificationBody(paymentMessage),
              channel: delivery.channel,
              status,
              sentAt: delivery.status === 'SENT' || delivery.status === 'QUEUED' ? new Date() : undefined,
              failureReason: delivery.error,
              relatedId: updatedInvoice.id,
              reference: String(payment.id),
            },
          });
        }
      } catch (dispatchError) {
        console.warn('⚠️ Failed to dispatch payment receipt:', dispatchError);
        await prisma.notification.create({
          data: {
            schoolId,
            guardianId: guardian.id,
            type: 'RECEIPT',
            title: 'Payment Receipt',
            body: truncateNotificationBody(paymentMessage),
            channel: guardian.whatsapp ? 'WHATSAPP' : 'EMAIL',
            status: 'FAILED',
            failureReason: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
            relatedId: updatedInvoice.id,
            reference: String(payment.id),
          },
        });
      }
    }

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      payment: {
        id: payment.id,
        amount: (payment.amount / 100).toFixed(2),
        method: payment.method,
        reference: payment.reference,
        paidAt: payment.paidAt,
      },
      invoice: {
        id: updatedInvoice.id,
        amountDue: (updatedInvoice.amountDue / 100).toFixed(2),
        amountPaid: (updatedInvoice.amountPaid / 100).toFixed(2),
        status: updatedInvoice.status,
      },
    });
  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// GET /api/admin/notifications - Get notification log
router.get('/notifications', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { type, status, channel, fromDate, toDate, limit = 100, offset = 0 } = req.query;

    let whereClause: any = { schoolId };

    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    if (channel) whereClause.channel = channel;

    if (fromDate && toDate) {
      const from = new Date(fromDate as string);
      const to = new Date(toDate as string);
      from.setUTCHours(0, 0, 0, 0);
      to.setUTCHours(23, 59, 59, 999);
      whereClause.createdAt = { gte: from, lte: to };
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: whereClause,
        include: {
          guardian: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip: Number(offset),
      }),
      prisma.notification.count({ where: whereClause }),
    ]);

    // Calculate statistics
    const stats = {
      total,
      sent: 0,
      failed: 0,
      pending: 0,
      byChannel: { WHATSAPP: 0, EMAIL: 0 },
      byType: { ISSUE_BILLS: 0, SEND_REMINDER: 0, ATTENDANCE_UPDATE: 0 },
    };

    const allNotifications = await prisma.notification.findMany({
      where: whereClause,
      select: { status: true, channel: true, type: true },
    });

    allNotifications.forEach((n) => {
      if (n.status === 'SENT') stats.sent++;
      if (n.status === 'FAILED') stats.failed++;
      if (n.status === 'PENDING') stats.pending++;
      stats.byChannel[n.channel as 'WHATSAPP' | 'EMAIL']++;
      stats.byType[n.type as 'ISSUE_BILLS' | 'SEND_REMINDER' | 'ATTENDANCE_UPDATE']++;
    });

    const mappedNotifications = notifications.map((n) => ({
      id: n.id,
      date: n.createdAt,
      guardian: `${n.guardian.firstName} ${n.guardian.lastName}`,
      guardianId: n.guardian.id,
      type: n.type,
      title: n.title,
      body: n.body,
      channel: n.channel,
      status: n.status,
      sentAt: n.sentAt,
      failureReason: n.failureReason,
      reference: n.reference,
    }));

    res.json({
      notifications: mappedNotifications,
      stats,
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// GET /api/admin/students/data - Get students list for client-side rendering
router.get('/students/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const [pupils, classes, school] = await Promise.all([
      prisma.pupil.findMany({
        where: { schoolId, isActive: true },
        include: {
          class: true,
          guardians: { include: { guardian: true } },
        },
        orderBy: { lastName: 'asc' },
      }),
      prisma.class.findMany({
        where: { schoolId },
        orderBy: { name: 'asc' },
      }),
      prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true, initials: true },
      }),
    ]);

    // Calculate next admission number
    let prefix = "SCH";
    if (school?.initials && typeof school.initials === "string" && school.initials.trim()) {
      prefix = school.initials.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    } else if (school?.name) {
      const words = school.name.split(/[^A-Za-z0-9]+/).filter(Boolean);
      let letters = words.slice(0, 3).map((w: string) => w[0]).join("").toUpperCase();
      if (letters.length < 3 && words[0]) {
        const remaining = words[0].slice(1).replace(/[^A-Za-z0-9]/g, "");
        for (const ch of remaining) {
          letters += ch.toUpperCase();
          if (letters.length >= 3) break;
        }
      }
      prefix = (letters || "SCH").replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }

    const year = new Date().getFullYear();
    const existingCount = await prisma.pupil.count({
      where: { schoolId, admissionNo: { startsWith: `${prefix}-${year}-` } },
    });
    const nextSeq = String(existingCount + 1).padStart(4, "0");
    const nextAdmissionNo = `${prefix}-${year}-${nextSeq}`;

    res.json({ pupils, classes, nextAdmissionNo });
  } catch (error) {
    console.error('Error fetching students data:', error);
    res.status(500).json({ error: 'Failed to fetch students data' });
  }
});

// POST /api/admin/students - Create new student with guardian
router.post('/students', upload.single('photo'), async (req: Request, res: Response) => {
  console.log('[create student] contentType=', req.headers['content-type']);
  console.log('[create student] body=', req.body);
  console.log('[create student] file=', req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path,
  } : null);

  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const {
      firstName: rawFirstName,
      lastName: rawLastName,
      middleName,
      admissionNo,
      classId,
      status,
      admissionDate,
      gender,
      dateOfBirth,
      studentEmail,
      studentPhone,
      address,
      bloodGroup,
      genotype,
      medicalNotes,
      previousSchool,
      previousClass,
      guardianFirst: rawGuardianFirst,
      guardianLast: rawGuardianLast,
      guardianRelationship,
      guardianEmail,
      guardianPhone,
      guardianAltPhone,
      guardianOccupation,
    } = req.body;

    const firstName = normalizeField(rawFirstName);
    const lastName = normalizeField(rawLastName);
    const guardianFirst = normalizeField(rawGuardianFirst);
    const guardianLast = normalizeField(rawGuardianLast);
    const normalizedStudentEmail = normalizeField(studentEmail);
    const normalizedStudentPhone = normalizeField(studentPhone);
    const normalizedAddress = normalizeField(address);
    const normalizedBloodGroup = normalizeField(bloodGroup);
    const normalizedGenotype = normalizeField(genotype);
    const normalizedMedicalNotes = normalizeField(medicalNotes);
    const normalizedPreviousSchool = normalizeField(previousSchool);
    const normalizedPreviousClass = normalizeField(previousClass);
    const normalizedGuardianEmail = normalizeField(guardianEmail);
    const normalizedGuardianPhone = normalizeField(guardianPhone);
    const normalizedGuardianAltPhone = normalizeField(guardianAltPhone);
    const normalizedGuardianOccupation = normalizeField(guardianOccupation);

    console.log('[create student] schoolId=%s, firstName=%s, lastName=%s, classId=%s, guardianFirst=%s, guardianLast=%s',
      schoolId,
      firstName,
      lastName,
      classId,
      guardianFirst,
      guardianLast,
    );

    // Validate required fields
    if (!firstName || !lastName) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'First name and last name are required',
        details: { firstName, lastName, schoolId },
      });
    }

    // Create pupil
    const pupil = await prisma.pupil.create({
      data: {
        schoolId,
        firstName,
        lastName,
        middleName: normalizeField(middleName),
        admissionNo,
        classId: classId || null,
        status: status || 'ACTIVE',
        admissionDate: admissionDate ? new Date(admissionDate) : new Date(),
        gender: normalizeField(gender),
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        studentEmail: normalizedStudentEmail,
        studentPhone: normalizedStudentPhone,
        address: normalizedAddress,
        bloodGroup: normalizedBloodGroup,
        genotype: normalizedGenotype,
        medicalNotes: normalizedMedicalNotes,
        previousSchool: normalizedPreviousSchool,
        previousClass: normalizedPreviousClass,
        photoUrl: req.file ? `/uploads/photos/${req.file.filename}` : null,
      },
      include: {
        class: true,
        guardians: { include: { guardian: true } },
      },
    });

    // Create or find guardian and link to pupil
    if (guardianFirst && guardianLast) {
      const guardian = await prisma.guardian.create({
        data: {
          schoolId,
          firstName: guardianFirst,
          lastName: guardianLast,
          phone: normalizedGuardianPhone || '',
          altPhone: normalizedGuardianAltPhone,
          email: normalizedGuardianEmail,
          occupation: normalizedGuardianOccupation,
        },
      });

      // Link guardian to pupil
      await prisma.guardianPupil.create({
        data: {
          guardianId: guardian.id,
          pupilId: pupil.id,
          relation: guardianRelationship || 'Parent',
        },
      });

      const whatsappAddress = guardian.whatsapp || guardian.phone;
      const recipients = [
        ...(guardian.email ? [{ channel: 'EMAIL' as const, address: guardian.email, name: guardian.firstName }] : []),
        ...(whatsappAddress ? [{ channel: 'WHATSAPP' as const, address: whatsappAddress, name: guardian.firstName }] : []),
      ];

      if (recipients.length > 0) {
        const className = pupil.class?.name || 'your class';
        const school = schoolId
          ? await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, logoUrl: true } })
          : null;
        const communicationService = createCommunicationService();
        const message = `Dear ${guardian.firstName}, ${pupil.firstName} ${pupil.lastName} has been successfully registered for ${className} at ${school?.name || 'your school'}. Admission Number: ${pupil.admissionNo || 'N/A'}. Please visit the parent portal for more details.`;

        try {
          const dispatchResult = await communicationService.dispatch({
            event: 'AdmissionCreated',
            schoolId,
            recipients,
            template: 'Admission',
            subject: 'Student Admission Completed',
            body: message,
            data: {
              studentName: `${pupil.firstName} ${pupil.lastName}`,
              className,
              admissionNo: String(pupil.admissionNo || 'N/A'),
              schoolName: school?.name || 'SchoolBase',
              recipientName: guardian.firstName,
            },
            metadata: {
              studentName: `${pupil.firstName} ${pupil.lastName}`,
              className,
              admissionNo: String(pupil.admissionNo || 'N/A'),
              schoolName: school?.name || 'SchoolBase',
              logoUrl: school?.logoUrl ?? undefined,
            },
          });

          for (const delivery of dispatchResult.deliveries) {
            const status = delivery.status === 'SENT' ? 'SENT' : delivery.status === 'QUEUED' ? 'PENDING' : 'FAILED';
            await prisma.notification.create({
              data: {
                schoolId,
                guardianId: guardian.id,
                type: 'ADMISSION',
                title: 'Admission Notification',
                body: truncateNotificationBody(message),
                channel: delivery.channel,
                status,
                sentAt: delivery.status === 'SENT' || delivery.status === 'QUEUED' ? new Date() : undefined,
                failureReason: delivery.error,
                relatedId: pupil.id,
                reference: String(pupil.admissionNo || 'N/A'),
              },
            });
          }
        } catch (dispatchError) {
          console.warn('⚠️ Failed to dispatch admission notification:', dispatchError);
          await prisma.notification.create({
            data: {
              schoolId,
              guardianId: guardian.id,
              type: 'ADMISSION',
              title: 'Admission Notification',
              body: truncateNotificationBody(message),
              channel: guardian.whatsapp ? 'WHATSAPP' : 'EMAIL',
              status: 'FAILED',
              failureReason: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
              relatedId: pupil.id,
              reference: String(pupil.admissionNo || 'N/A'),
            },
          });
        }
      }
    }

    // Fetch updated pupil with guardians
    const updatedPupil = await prisma.pupil.findUnique({
      where: { id: pupil.id },
      include: {
        class: true,
        guardians: { include: { guardian: true } },
      },
    });

    res.status(201).json(updatedPupil);
  } catch (error) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // ignore
      }
    }
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Failed to create student' });
  }
});

// GET /api/admin/students/:id - Get single student data
router.get('/students/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { id } = req.params;

    const pupil = await prisma.pupil.findFirst({
      where: { id, schoolId },
      include: {
        class: true,
        guardians: { include: { guardian: true } },
      },
    });

    if (!pupil) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Fetch invoices and calculate fees balance
    const invoices = await prisma.invoice.findMany({
      where: { pupilId: id, schoolId },
    });

    const totalDue = invoices.reduce((sum, inv) => sum + inv.amountDue, 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
    const feesBalance = totalDue - totalPaid;

    res.json({
      ...pupil,
      feesBalance,
      invoiceCount: invoices.length,
    });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// PATCH /api/admin/students/:id - Update student data
router.patch('/students/:id', upload.single('photo'), async (req: Request, res: Response) => {
  console.log('[update student] contentType=', req.headers['content-type']);
  console.log('[update student] body=', req.body);
  console.log('[update student] file=', req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path,
  } : null);

  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { id } = req.params;

    // Verify student exists and belongs to school
    const existingPupil = await prisma.pupil.findFirst({
      where: { id, schoolId },
    });

    if (!existingPupil) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Student not found' });
    }

    const {
      firstName,
      middleName,
      lastName,
      classId,
      status,
      admissionDate,
      gender,
      dateOfBirth,
      studentEmail,
      studentPhone,
      address,
      bloodGroup,
      genotype,
      medicalNotes,
      previousSchool,
      previousClass,
      guardianFirst,
      guardianLast,
      guardianRelationship,
      guardianEmail,
      guardianPhone,
      guardianAltPhone,
      guardianOccupation,
    } = req.body;

    // Prepare photo URL if file was uploaded
    let photoUrl = existingPupil.photoUrl;
    if (req.file) {
      // Delete old photo if exists
      if (existingPupil.photoUrl) {
        const oldPath = path.join(process.cwd(), 'uploads', existingPupil.photoUrl.replace('/uploads/', ''));
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      photoUrl = `/uploads/photos/${req.file.filename}`;
    }

    // Update pupil
    const updatedPupil = await prisma.pupil.update({
      where: { id },
      data: {
        firstName: firstName || undefined,
        middleName: middleName || undefined,
        lastName: lastName || undefined,
        classId: classId || undefined,
        status: status || undefined,
        admissionDate: admissionDate ? new Date(admissionDate) : undefined,
        gender: gender || undefined,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        studentEmail: studentEmail || undefined,
        studentPhone: studentPhone || undefined,
        address: address || undefined,
        bloodGroup: bloodGroup || undefined,
        genotype: genotype || undefined,
        medicalNotes: medicalNotes || undefined,
        previousSchool: previousSchool || undefined,
        previousClass: previousClass || undefined,
        photoUrl,
      },
      include: {
        class: true,
        guardians: { include: { guardian: true } },
      },
    });

    res.json(updatedPupil);
  } catch (error) {
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // ignore
      }
    }
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// GET /api/admin/classes/data - Get classes list for client-side rendering
router.get('/classes/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const classes = await prisma.class.findMany({
      where: { schoolId },
      orderBy: [{ phase: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            pupils: true,
            subjectClasses: true,
          },
        },
      },
    });

    res.json({ classes });
  } catch (error) {
    console.error('Error fetching classes data:', error);
    res.status(500).json({ error: 'Failed to fetch classes data' });
  }
});

// GET /api/admin/promotions/preview - Preview promotion decisions for a class
router.get('/promotions/preview', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { academicYearId, termId, classId } = req.query;
    if (!academicYearId || !termId || !classId) {
      return res.status(400).json({ error: 'academicYearId, termId, and classId are required' });
    }

    const currentClass = await prisma.class.findFirst({ where: { id: String(classId), schoolId } });
    if (!currentClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const pupils = await prisma.pupil.findMany({
      where: { schoolId, classId: String(classId), isActive: true },
      include: { class: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const classes = await prisma.class.findMany({
      where: { schoolId },
      orderBy: [{ phase: 'asc' }, { name: 'asc' }],
    });

    res.json({
      academicYearId: String(academicYearId),
      termId: String(termId),
      classId: String(classId),
      class: currentClass,
      pupils: pupils.map((pupil) => ({
        id: pupil.id,
        firstName: pupil.firstName,
        lastName: pupil.lastName,
        admissionNo: pupil.admissionNo,
        currentClassId: pupil.classId,
        currentClassName: pupil.class?.name || null,
        promotionDecision: null,
        promotionToClassId: null,
        rationale: null,
      })),
      classes,
    });
  } catch (error) {
    console.error('Error previewing promotions:', error);
    res.status(500).json({ error: 'Failed to preview promotions' });
  }
});

// POST /api/admin/promotions/apply - Apply promotion decisions for pupils
router.post('/promotions/apply', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { academicYearId, termId, fromClassId, decisions } = req.body;
    if (!academicYearId || !termId || !fromClassId || !Array.isArray(decisions) || decisions.length === 0) {
      return res.status(400).json({ error: 'academicYearId, termId, fromClassId and decisions are required' });
    }

    const currentClass = await prisma.class.findFirst({ where: { id: String(fromClassId), schoolId } });
    if (!currentClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const pupilIds = decisions.map((item: any) => String(item.pupilId));
    const pupils = await prisma.pupil.findMany({ where: { id: { in: pupilIds }, schoolId } });
    const pupilsById = Object.fromEntries(pupils.map((p) => [p.id, p]));

    if (pupils.length !== pupilIds.length) {
      return res.status(400).json({ error: 'One or more pupils were not found' });
    }

    const validClassIds = decisions
      .map((item: any) => item.toClassId)
      .filter(Boolean)
      .map(String);

    const targetClasses = validClassIds.length
      ? await prisma.class.findMany({ where: { id: { in: validClassIds }, schoolId } })
      : [];
    const targetClassIds = new Set(targetClasses.map((c) => c.id));

    for (const decision of decisions) {
      if (!['PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED'].includes(decision.decision)) {
        return res.status(400).json({ error: `Invalid decision: ${decision.decision}` });
      }
      if (['PROMOTED', 'TRANSFERRED'].includes(decision.decision) && !decision.toClassId) {
        return res.status(400).json({ error: 'toClassId is required for promoted or transferred pupils' });
      }
      if (decision.toClassId && !targetClassIds.has(String(decision.toClassId))) {
        return res.status(400).json({ error: `Invalid toClassId: ${decision.toClassId}` });
      }
    }

    const decidedBy = (await resolveUserName(req)) || 'Unknown';
    const decidedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await Promise.all(decisions.map(async (decision: any) => {
        const pupil = pupilsById[decision.pupilId];
        const toClassId = decision.toClassId ? String(decision.toClassId) : null;
        let nextClassId: string | null = pupil.classId;

        if (decision.decision === 'PROMOTED' || decision.decision === 'TRANSFERRED') {
          nextClassId = toClassId;
        } else if (decision.decision === 'GRADUATED') {
          nextClassId = null;
        }

        await tx.pupil.update({
          where: { id: pupil.id },
          data: { classId: nextClassId },
        });

        await tx.promotionRecord.create({
          data: {
            schoolId,
            pupilId: pupil.id,
            fromClassId: String(fromClassId),
            toClassId,
            academicYearId: String(academicYearId),
            termId: String(termId),
            decision: decision.decision,
            rationale: decision.rationale || null,
            decidedBy,
            decidedAt,
          },
        });

        await tx.studentTermSummary.updateMany({
          where: { pupilId: pupil.id, termId: String(termId) },
          data: {
            promotionDecision: decision.decision,
            promotionToClass: toClassId,
            promotionDecidedBy: decidedBy,
            promotionDecidedAt: decidedAt,
          },
        });
      }));
    });

    res.json({ success: true, appliedCount: decisions.length });
  } catch (error) {
    console.error('Error applying promotions:', error);
    res.status(500).json({ error: 'Failed to apply promotions' });
  }
});

// GET /api/admin/promotions/history - Get promotion history records
router.get('/promotions/history', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { academicYearId, termId, classId, pupilId } = req.query;
    const where: any = { schoolId };
    if (academicYearId) where.academicYearId = String(academicYearId);
    if (termId) where.termId = String(termId);
    if (pupilId) where.pupilId = String(pupilId);
    if (classId) where.fromClassId = String(classId);

    const records = await prisma.promotionRecord.findMany({
      where,
      orderBy: { decidedAt: 'desc' },
    });

    const pupilIds = [...new Set(records.map((record) => record.pupilId))];
    const classIds = [...new Set(
      records.flatMap((record) => [record.fromClassId, record.toClassId]).filter((id): id is string => typeof id === 'string')
    )];

    const [pupils, classes] = await Promise.all([
      prisma.pupil.findMany({ where: { id: { in: pupilIds } } }),
      prisma.class.findMany({ where: { id: { in: classIds } } }),
    ]);

    const pupilsById = Object.fromEntries(pupils.map((p) => [p.id, p]));
    const classesById = Object.fromEntries(classes.map((c) => [c.id, c]));

    res.json({
      records: records.map((record) => ({
        id: record.id,
        pupilId: record.pupilId,
        pupilName: `${pupilsById[record.pupilId]?.firstName || ''} ${pupilsById[record.pupilId]?.lastName || ''}`.trim(),
        fromClassId: record.fromClassId,
        fromClassName: classesById[record.fromClassId]?.name || null,
        toClassId: record.toClassId,
        toClassName: record.toClassId ? classesById[record.toClassId]?.name || null : null,
        decision: record.decision,
        rationale: record.rationale,
        decidedBy: record.decidedBy,
        decidedAt: record.decidedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching promotion history:', error);
    res.status(500).json({ error: 'Failed to fetch promotion history' });
  }
});

// GET /api/admin/teachers/data - Get teachers, classes, and subjects for client-side rendering
router.get('/teachers/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const [classes, subjects, teachers] = await Promise.all([
      prisma.class.findMany({
        where: { schoolId },
        orderBy: { name: 'asc' },
      }),
      prisma.subject.findMany({
        where: { schoolId },
        orderBy: { name: 'asc' },
      }),
      prisma.user.findMany({
        where: { schoolId, role: 'TEACHER' },
        orderBy: { name: 'asc' },
        include: {
          teacherClasses: { include: { class: true } },
          teacherSubjects: { include: { subject: true } },
        },
      }),
    ]);

    res.json({ classes, subjects, teachers });
  } catch (error) {
    console.error('Error fetching teachers data:', error);
    res.status(500).json({ error: 'Failed to fetch teachers data' });
  }
});

// GET /api/admin/results/data - Get assessments for client-side rendering
router.get('/results/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const currentAcademicYear = await prisma.academicYear.findFirst({
      where: { schoolId, isCurrent: true },
      select: { id: true, name: true },
    });

    const academicYears = await prisma.academicYear.findMany({
      where: { schoolId },
      select: { id: true, name: true, isCurrent: true },
      orderBy: [{ isCurrent: 'desc' }, { name: 'asc' }],
    });

    const assessments = await prisma.assessment.findMany({
      where: { schoolId },
      include: {
        _count: { select: { results: true } },
        term: {
          include: {
            academicYear: {
              select: {
                id: true,
                name: true,
                isCurrent: true,
              },
            },
          },
        },
        results: { select: { lockedAt: true } },
      },
      orderBy: [{ phase: 'asc' }, { createdAt: 'desc' }],
    });

    const sortedAssessments = [...assessments].sort((a, b) => {
      const aIsCurrent = a.term?.academicYear?.isCurrent === true;
      const bIsCurrent = b.term?.academicYear?.isCurrent === true;

      if (aIsCurrent !== bIsCurrent) {
        return Number(bIsCurrent) - Number(aIsCurrent);
      }

      const aTermOrder = a.term?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bTermOrder = b.term?.sortOrder ?? Number.MAX_SAFE_INTEGER;

      if (aTermOrder !== bTermOrder) {
        return aTermOrder - bTermOrder;
      }

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json({
      assessments: sortedAssessments.map((assessment) => ({
        ...assessment,
        isLocked: assessment.results.some((result) => result.lockedAt !== null),
        canEdit: assessment.status === 'DRAFT' && !assessment.results.some((result) => result.lockedAt !== null),
        sessionName: assessment.term?.academicYear?.name ?? null,
      })),
      sessions: academicYears.map((academicYear) => ({
        id: academicYear.id,
        name: academicYear.name,
        isCurrent: academicYear.isCurrent,
      })),
    });
  } catch (error) {
    console.error('Error fetching results data:', error);
    res.status(500).json({ error: 'Failed to fetch results data' });
  }
});

// GET /api/admin/subjects/data - Get subjects, classes, and related data
router.get('/subjects/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const [subjects, classes, subjectClasses, teacherSubjects] = await Promise.all([
      prisma.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
      prisma.class.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
      prisma.subjectClass.findMany({ where: { schoolId }, include: { class: true } }),
      prisma.teacherSubject.findMany({ where: { schoolId }, include: { teacher: true } }),
    ]);

    res.json({ subjects, classes, subjectClasses, teacherSubjects });
  } catch (error) {
    console.error('Error fetching subjects data:', error);
    res.status(500).json({ error: 'Failed to fetch subjects data' });
  }
});

// GET /api/admin/teacher-assignments/data - Get teacher assignments data
router.get('/teacher-assignments/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const [teachers, classes, subjects] = await Promise.all([
      prisma.user.findMany({
        where: { schoolId, role: 'TEACHER' },
        include: {
          teacherClasses: { include: { class: true } },
          teacherSubjects: { include: { subject: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.class.findMany({
        where: { schoolId },
        orderBy: { name: 'asc' },
      }),
      prisma.subject.findMany({
        where: { schoolId },
        orderBy: { name: 'asc' },
      }),
    ]);

    res.json({ teachers, classes, subjects });
  } catch (error) {
    console.error('Error fetching teacher-assignments data:', error);
    res.status(500).json({ error: 'Failed to fetch teacher-assignments data' });
  }
});

// GET /api/admin/website/data - Get website announcements
router.get('/website/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const announcements = await prisma.announcement.findMany({
      where: { schoolId },
      orderBy: { publishedAt: 'desc' },
    });

    res.json({ announcements });
  } catch (error) {
    console.error('Error fetching website data:', error);
    res.status(500).json({ error: 'Failed to fetch website data' });
  }
});

// GET /api/admin/support/data - Get support requests
router.get('/support/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const supportRequests = await prisma.supportRequest.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } } as any,
    });

    const school = await prisma.school.findUnique({ where: { id: schoolId } });

    res.json({ 
      supportRequests: (supportRequests as any[]).map((request) => {
        const messages = ((request as any).messages || []).map((message: any) => {
          const isSchoolMessage = message.senderRole === 'SCHOOL';
          const normalizedSenderName = typeof message.senderName === 'string' ? message.senderName.trim() : '';
          const senderName = isSchoolMessage
            ? (school?.name || normalizedSenderName || 'School')
            : 'SchoolBase Support';

          return {
            id: message.id,
            senderRole: message.senderRole,
            senderName,
            senderEmail: message.senderEmail,
            body: message.body,
            createdAt: message.createdAt.toISOString(),
          };
        });

        if (request.response && !messages.some((message: any) => message.body === request.response)) {
          messages.push({
            id: `${request.id}-response`,
            senderRole: 'PLATFORM_ADMIN',
            senderName: 'SchoolBase Support',
            senderEmail: null,
            body: request.response,
            createdAt: request.updatedAt.toISOString(),
          });
        }

        return {
          id: request.id,
          subject: request.subject,
          message: request.message,
          response: request.response,
          status: request.status,
          priority: request.priority,
          createdAt: request.createdAt.toISOString(),
          updatedAt: request.updatedAt.toISOString(),
          messages,
          school: {
            id: schoolId,
            name: school?.name,
            country: school?.country,
          },
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching support data:', error);
    res.status(500).json({ error: 'Failed to fetch support data' });
  }
});

// POST /api/admin/support - Create support request
router.post('/support', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { subject, message, priority = 'MEDIUM' } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and message are required' });
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, country: true } });

    const supportRequest = await prisma.$transaction(async (tx) => {
      const createdRequest = await tx.supportRequest.create({
        data: {
          schoolId,
          subject,
          message,
          priority,
          status: 'OPEN',
        },
      });

      await tx.supportRequestMessage.create({
        data: {
          supportRequestId: createdRequest.id,
          senderRole: 'SCHOOL',
          senderName: school?.name || 'School',
          senderEmail: null,
          body: createdRequest.message,
        },
      });

      return createdRequest;
    });

    res.status(201).json({ 
      supportRequest: {
        id: supportRequest.id,
        subject: supportRequest.subject,
        message: supportRequest.message,
        response: supportRequest.response,
        status: supportRequest.status,
        priority: supportRequest.priority,
        createdAt: supportRequest.createdAt.toISOString(),
        updatedAt: supportRequest.updatedAt.toISOString(),
        messages: [{
          id: `${supportRequest.id}-initial`,
          senderRole: 'SCHOOL',
          senderName: school?.name || 'School',
          senderEmail: null,
          body: supportRequest.message,
          createdAt: supportRequest.createdAt.toISOString(),
        }],
        school: school ? {
          id: school.id,
          name: school.name,
          country: school.country,
        } : null,
      },
      message: 'Support request created successfully'
    });
  } catch (error) {
    console.error('Error creating support request:', error);
    res.status(500).json({ error: 'Failed to create support request' });
  }
});

// PATCH /api/admin/support/reply - Reply to support request
router.patch('/support/reply', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { requestId, response: responseText } = req.body;

    if (!requestId || !responseText) {
      return res.status(400).json({ error: 'Request ID and response are required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, country: true },
    });

    // Verify the support request belongs to this school
    const supportRequest = await prisma.supportRequest.findFirst({
      where: { id: requestId, schoolId },
    });

    if (!supportRequest) {
      return res.status(404).json({ error: 'Support request not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportRequest.update({
        where: { id: requestId },
        data: {
          response: responseText,
          status: 'IN_PROGRESS',
          updatedAt: new Date(),
        },
      });

      await tx.supportRequestMessage.create({
        data: {
          supportRequestId: requestId,
          senderRole: 'SCHOOL',
          senderName: school?.name || 'School',
          senderEmail: null,
          body: responseText,
        },
      });

      return tx.supportRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { messages: { orderBy: { createdAt: 'asc' } } } as any,
      });
    });

    const messages = ((updated.messages || []).map((message: any) => {
      const isSchoolMessage = message.senderRole === 'SCHOOL';
      const normalizedSenderName = typeof message.senderName === 'string' ? message.senderName.trim() : '';
      const senderName = isSchoolMessage
        ? (school?.name || normalizedSenderName || 'School')
        : 'SchoolBase Support';

      return {
        id: message.id,
        senderRole: message.senderRole,
        senderName,
        senderEmail: message.senderEmail,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      };
    }));

    res.json({ 
      supportRequest: {
        id: updated.id,
        subject: updated.subject,
        message: updated.message,
        response: updated.response,
        status: updated.status,
        priority: updated.priority,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        messages,
        school: null,
      },
      message: 'Reply sent successfully'
    });
  } catch (error) {
    console.error('Error replying to support request:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// GET /api/admin/attendance/data - Get attendance data for client-side rendering
router.get('/attendance/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const classes = await prisma.class.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    });

    res.json({ classes });
  } catch (error) {
    console.error('Error fetching attendance data:', error);
    res.status(500).json({ error: 'Failed to fetch attendance data' });
  }
});

// GET /api/admin/notifications/data - Get notifications list
router.get('/notifications/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const notifications = await prisma.notification.findMany({
      where: { schoolId },
      include: { guardian: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const stats = {
      total: notifications.length,
      sent: notifications.filter((n: any) => n.status === 'SENT').length,
      failed: notifications.filter((n: any) => n.status === 'FAILED').length,
      pending: notifications.filter((n: any) => n.status === 'PENDING').length,
    };

    res.json({ notifications, stats });
  } catch (error) {
    console.error('Error fetching notifications data:', error);
    res.status(500).json({ error: 'Failed to fetch notifications data' });
  }
});

// GET /api/admin/analytics/data - Get school analytics
router.get('/analytics/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const termId = req.query.termId as string | undefined;
    const phaseQuery = req.query.phase as string | undefined;
    const selectedClassId = (req.query.classId as string | undefined) || (req.query.sectionId as string | undefined);
    
    console.log('[ANALYTICS] Received termId:', termId, 'phase:', phaseQuery, 'classId:', selectedClassId);
    
    // Build filter for assessments
    const assessmentWhere: any = {
      schoolId,
      status: {
        in: ['APPROVED', 'PUBLISHED', 'ARCHIVED'],
      },
    };
    
    if (phaseQuery && phaseQuery !== 'ALL') {
      assessmentWhere.phase = phaseQuery;
    }

    if (termId) {
      assessmentWhere.termId = termId;
    }

    if (selectedClassId) {
      assessmentWhere.classId = selectedClassId;
    }

    console.log('[ANALYTICS] assessmentWhere filter:', JSON.stringify(assessmentWhere));

    // Fetch published assessments for the selected term and phase
    const assessments = await prisma.assessment.findMany({
      where: assessmentWhere,
      select: { id: true, classId: true },
    });
    
    console.log('[ANALYTICS] Found assessments:', assessments.length);

    const assessmentIds = assessments.map((a) => a.id);
    const classIds = [...new Set(assessments.map((a) => a.classId).filter(Boolean))] as string[];

    // Fetch classes for display
    // If a specific class is selected, return that class
    // Otherwise, return all school classes (so user can see available classes even if no assessments exist)
    const classes = selectedClassId
      ? await prisma.class.findMany({
          where: {
            schoolId,
            id: selectedClassId,
          },
          select: {
            id: true,
            name: true,
            phase: true,
          },
          orderBy: { name: 'asc' },
        })
      : await prisma.class.findMany({
          where: {
            schoolId,
          },
          select: {
            id: true,
            name: true,
            phase: true,
          },
          orderBy: { name: 'asc' },
        });

    // Get all subjects for the school
    // First, get all results for the selected assessments
    const allResults = await prisma.result.findMany({
      where: {
        assessmentId: { in: assessmentIds },
      },
      select: { subjectId: true },
      distinct: ['subjectId'],
    });

    const subjectIds = allResults
      .map(r => r.subjectId)
      .filter(Boolean) as string[];

    // Fetch only subjects that have results in the selected term/phase/class
    const subjects = subjectIds.length > 0
      ? await prisma.subject.findMany({
          where: {
            schoolId,
            id: { in: subjectIds },
          },
          orderBy: { name: 'asc' },
        })
      : [];

    // Fetch results for these assessments (for analytics calculation)
    const results = await prisma.result.findMany({
      where: {
        assessmentId: { in: assessmentIds },
        OR: [
          { publishedAt: { not: null } },
          { totalScore: { not: null } },
          { grade: { not: null } },
        ],
      },
      include: {
        pupil: true,
      },
    });

    // Calculate grade distribution
    const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };

    results.forEach((result: any) => {
      // Calculate grade from score (assuming 40+ is pass)
      const score = result.totalScore || 0;
      let grade = 'F';
      if (score >= 90) grade = 'A';
      else if (score >= 80) grade = 'B';
      else if (score >= 70) grade = 'C';
      else if (score >= 60) grade = 'D';
      else if (score >= 40) grade = 'E';

      gradeDistribution[grade]++;
    });

    const schoolAverage = results.length > 0 
      ? (results.reduce((sum: number, r: any) => sum + (r.totalScore || 0), 0) / results.length) 
      : 0;

    const passCount = results.filter((r: any) => (r.totalScore || 0) >= 40).length;
    const passRate = results.length > 0 ? (passCount / results.length) * 100 : 0;

    // Get top performers and struggling students
    const sortedResults = [...results].sort((a: any, b: any) => (b.totalScore || 0) - (a.totalScore || 0));
    const topPerformers = sortedResults.slice(0, 10).map((r: any) => {
      const pupilName = r.pupil ? `${r.pupil.firstName} ${r.pupil.lastName}`.trim() : 'Unknown';
      return {
        name: pupilName,
        score: r.totalScore || 0,
      };
    });

    const strugglingStudents = sortedResults.slice(-10).map((r: any) => {
      const pupilName = r.pupil ? `${r.pupil.firstName} ${r.pupil.lastName}`.trim() : 'Unknown';
      return {
        name: pupilName,
        score: r.totalScore || 0,
      };
    }).reverse();

    res.json({
      schoolAnalytics: {
        schoolAverage: Math.round(schoolAverage * 10) / 10,
        passRate: Math.round(passRate * 10) / 10,
        totalResults: results.length,
        gradeDistribution,
        topPerformers,
        strugglingStudents,
      },
      classes,
      subjects,
    });
  } catch (error) {
    console.error('Error fetching analytics data:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

// GET /api/admin/communications/rules - Get communication rules for the current school
router.get('/communications/rules', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    res.json({
      success: true,
      rules: communicationRulesRegistry.getRules(schoolId),
    });
  } catch (error) {
    console.error('Error fetching communication rules:', error);
    res.status(500).json({ error: 'Failed to fetch communication rules' });
  }
});

// PUT /api/admin/communications/rules - Update communication rules for the current school
router.put('/communications/rules', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { event, enabled } = req.body as { event?: string; enabled?: boolean };
    if (!event || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'event and enabled are required' });
    }

    communicationRulesRegistry.setRuleEnabled(schoolId, event, enabled);
    res.json({ success: true, rules: communicationRulesRegistry.getRules(schoolId) });
  } catch (error) {
    console.error('Error updating communication rules:', error);
    res.status(500).json({ error: 'Failed to update communication rules' });
  }
});

// GET /api/admin/whatsapp/data - Get WhatsApp delivery status
router.get('/whatsapp/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    res.json({
      deliveries: [],
      successCount: 0,
      failureCount: 0,
      session: baileysSessionManager.getStatus(schoolId),
      queue: sharedDeliveryQueue.getQueueSummary(),
    });
  } catch (error) {
    console.error('Error fetching whatsapp data:', error);
    res.status(500).json({ error: 'Failed to fetch whatsapp data' });
  }
});

// POST /api/admin/whatsapp/connect - Establish a WPPConnect session for the current school
router.post('/whatsapp/connect', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const status = await baileysSessionManager.connect(schoolId);
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('Error connecting whatsapp:', error);
    res.status(500).json({ error: 'Failed to connect WhatsApp' });
  }
});

// GET /api/admin/whatsapp/queue - Get pending WhatsApp delivery retry queue
router.get('/whatsapp/queue', requireSubscription, async (req: Request, res: Response) => {
  try {
    res.json({ success: true, queue: sharedDeliveryQueue.getQueueSummary() });
  } catch (error) {
    console.error('Error fetching whatsapp queue:', error);
    res.status(500).json({ error: 'Failed to fetch WhatsApp queue' });
  }
});

// POST /api/admin/whatsapp/retry - Retry a manual WhatsApp message or queued item
router.post('/whatsapp/retry', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { phoneNumber, message, recipientName = 'Guardian' } = req.body;
    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'phoneNumber and message required' });
    }

    const communicationService = createCommunicationService();
    const dispatchResult = await communicationService.dispatch({
      event: 'WhatsAppRetry',
      schoolId,
      recipients: [{ channel: 'WHATSAPP', address: phoneNumber, name: recipientName }],
      body: message,
      data: { recipientName, schoolName: 'SchoolBase' },
    });

    res.json({
      success: dispatchResult.success,
      result: dispatchResult,
    });
  } catch (error) {
    console.error('Error retrying WhatsApp message:', error);
    res.status(500).json({ error: 'Failed to retry WhatsApp message' });
  }
});

// POST /api/admin/whatsapp/disconnect - End the WPPConnect session for the current school
router.post('/whatsapp/disconnect', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const status = await baileysSessionManager.disconnect(schoolId);
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('Error disconnecting whatsapp:', error);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp' });
  }
});

// GET /api/admin/whatsapp-baileys/status - Get Baileys WhatsApp session status for the current school
router.get('/whatsapp-baileys/status', requireSubscription, async (req: Request, res: Response) => {
  try {
    console.log('[Baileys Status] Getting status...');
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });
    const status = baileysSessionManager.getStatus(schoolId);
    console.log('[Baileys Status] Status retrieved for', schoolId, status);
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('Error fetching Baileys whatsapp status:', error);
    res.status(500).json({ error: 'Failed to fetch Baileys WhatsApp status' });
  }
});

// POST /api/admin/whatsapp-baileys/connect - Start a minimal Baileys session
router.post('/whatsapp-baileys/connect', requireSubscription, async (req: Request, res: Response) => {
  try {
    const pairingPhoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : undefined;
    const usePairingCode = Boolean(req.body?.usePairingCode);
    console.log('[Baileys Connect] Starting connection...', { pairingPhoneNumber, usePairingCode });
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });
    const status = await baileysSessionManager.connect(schoolId, pairingPhoneNumber, usePairingCode);
    console.log('[Baileys Connect] Connection status for', schoolId, status);
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('Error connecting Baileys whatsapp:', error);
    res.status(500).json({ error: 'Failed to connect Baileys WhatsApp' });
  }
});

// POST /api/admin/whatsapp-baileys/debug - Run a one-off Baileys diagnostic probe
router.post('/whatsapp-baileys/debug', requireSubscription, async (req: Request, res: Response) => {
  try {
    const result = await baileysSessionManager.runDeepDebugProbe();
    res.json({ success: true, result });
  } catch (error) {
    console.error('Error running Baileys debug probe:', error);
    res.status(500).json({ error: 'Failed to run Baileys debug probe' });
  }
});

// POST /api/admin/whatsapp-baileys/send-message - Send a test message using Baileys
router.post('/whatsapp-baileys/send-message', requireSubscription, async (req: Request, res: Response) => {
  try {
    const { phoneNumber, phoneNumbers, message } = req.body;
    const recipients = Array.isArray(phoneNumbers) ? phoneNumbers : phoneNumber ? [phoneNumber] : [];

    if (!recipients.length || !message) {
      return res.status(400).json({ error: 'phoneNumber(s) and message required' });
    }

    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    // Append school signature/details automatically for admin-sent test messages
    let finalMessage = message;
    try {
      const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, phone: true, email: true } });
      if (school) {
        const parts = [] as string[];
        if (school.name) parts.push(String(school.name));
        if (school.phone) parts.push(String(school.phone));
        if (school.email) parts.push(String(school.email));
        if (parts.length > 0 && !String(message || '').includes(parts[0])) {
          finalMessage = `${String(message || '')}\n\n— ${parts.join(' | ')}`;
        }
      }
    } catch (e) {
      console.warn('[Baileys Send] Failed to load school details for signature', e);
    }

    const result = await baileysSessionManager.sendTextMessages(schoolId, recipients, finalMessage);
    if (!result.success) {
      return res.status(400).json({ success: false, error: 'One or more recipients failed', results: result.results });
    }

    res.json({ success: true, results: result.results });
  } catch (error) {
    console.error('Error sending Baileys whatsapp message:', error);
    res.status(500).json({ error: 'Failed to send Baileys WhatsApp message' });
  }
});

// POST /api/admin/whatsapp-baileys/disconnect - Disconnect Baileys session
router.post('/whatsapp-baileys/disconnect', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });
    const status = await baileysSessionManager.disconnect(schoolId);
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('Error disconnecting Baileys whatsapp:', error);
    res.status(500).json({ error: 'Failed to disconnect Baileys WhatsApp' });
  }
});

// GET /api/admin/subscribe/data - Get subscription data
router.get('/subscribe/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });

    res.json({
      school: {
        id: school?.id,
        name: school?.name,
        country: school?.country,
        slug: school?.slug,
      },
      session: {
        name: 'Administrator',
        email: '',
      },
    });
  } catch (error) {
    console.error('Error fetching subscribe data:', error);
    res.status(500).json({ error: 'Failed to fetch subscribe data' });
  }
});

// GET /api/admin/school/:schoolId/setup-status - Get school setup completion status
router.get('/school/:schoolId/setup-status', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;

    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Check setup completion items
    const [
      enabledPhases,
      academicYears,
      classes,
      subjects,
      teacherClasses,
      feeSchedules,
    ] = await Promise.all([
      prisma.schoolOnPhase.count({ where: { schoolId } }),
      prisma.academicYear.count({ where: { schoolId } }),
      prisma.class.count({ where: { schoolId } }),
      prisma.subject.count({ where: { schoolId } }),
      prisma.teacherClass.count({ where: { schoolId } }),
      prisma.feeSchedule.count({ where: { schoolId } }),
    ]);

    const setupItems = {
      hasEnabledPhases: enabledPhases > 0,
      hasAcademicYears: academicYears > 0,
      hasClasses: classes > 0,
      hasSubjects: subjects > 0,
      hasStaff: teacherClasses > 0,
      hasFees: feeSchedules > 0,
    };

    // School is considered complete if it has all setup items
    const isComplete = Object.values(setupItems).every((item) => item === true);

    const incompleteItems = Object.entries(setupItems)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    res.json({
      isComplete,
      setupItems,
      incompleteItems,
      completionPercentage: Math.round(
        (Object.values(setupItems).filter((v) => v).length / Object.values(setupItems).length) * 100
      ),
    });
  } catch (error) {
    console.error('Error fetching setup status:', error);
    res.status(500).json({ error: 'Failed to fetch setup status' });
  }
});

// ============== RESULTS/ASSESSMENTS MANAGEMENT ==============

// GET /api/admin/terms - Fetch available terms for current academic year
router.get('/terms', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const terms = await prisma.term.findMany({
      where: {
        academicYear: {
          schoolId,
        },
      },
      orderBy: [
        { academicYear: { isCurrent: 'desc' } },
        { academicYear: { createdAt: 'desc' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        academicYearId: true,
        academicYear: {
          select: {
            isCurrent: true,
          },
        },
      },
    });

    const normalizedTerms = terms.map((term) => ({
      id: term.id,
      name: term.name,
      sortOrder: term.sortOrder,
      academicYearId: term.academicYearId,
      isCurrent: term.academicYear?.isCurrent ?? false,
    }));

    res.json({ terms: normalizedTerms });
  } catch (error) {
    console.error('Error fetching terms:', error);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// GET /api/admin/results/{id} - Fetch single assessment with results
router.get('/results/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId },
      include: {
        term: {
          include: {
            academicYear: {
              select: {
                id: true,
                name: true,
                isCurrent: true,
              },
            },
          },
        },
        results: {
          include: {
            pupil: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNo: true,
                class: {
                  select: {
                    id: true,
                    name: true,
                    arm: true,
                    phase: true,
                  },
                },
              },
            },
            subjectRef: true,
          },
        },
        _count: { select: { results: true } },
      },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Transform results to include full name
    const transformedResults = assessment.results.map((r) => ({
      ...r,
      pupil: {
        ...r.pupil,
        name: `${r.pupil.firstName} ${r.pupil.lastName}`.trim(),
      },
    }));

    // Third term historical totals support
    let thirdTermHistory = null;
    const currentTerm = assessment.term;
    if (currentTerm?.sortOrder === 3 && currentTerm.academicYear?.id) {
      const previousTerms = await prisma.term.findMany({
        where: {
          academicYearId: currentTerm.academicYear.id,
          sortOrder: { in: [1, 2] },
        },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          name: true,
          sortOrder: true,
        },
      });

      if (previousTerms.length > 0) {
        const buildSubjectKey = (subjectId: string | null, subject: string | null) =>
          subjectId ? `id:${subjectId}` : `name:${subject?.trim().toLowerCase() ?? ''}`;

        const previousResults = await prisma.result.findMany({
          where: {
            assessment: {
              termId: { in: previousTerms.map((term) => term.id) },
              status: 'PUBLISHED',
              schoolId,
            },
            pupilId: { in: transformedResults.map((result) => result.pupil.id) },
          },
          include: {
            assessment: {
              select: {
                id: true,
                term: {
                  select: {
                    id: true,
                    name: true,
                    sortOrder: true,
                  },
                },
              },
            },
            pupil: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNo: true,
              },
            },
          },
        });

        const publishedTermData = new Map<string, {
          totalScore: number;
          examScore: number;
          totalCount: number;
          examCount: number;
        }>();

        previousResults.forEach((previousResult) => {
          const pupilId = previousResult.pupilId;
          const termSort = previousResult.assessment?.term?.sortOrder;
          if (!termSort) return;

          const subjectKey = buildSubjectKey(previousResult.subjectId ?? null, previousResult.subject ?? null);
          const key = `${pupilId}:${subjectKey}:${termSort}`;
          const existingTermData = publishedTermData.get(key) ?? {
            totalScore: 0,
            examScore: 0,
            totalCount: 0,
            examCount: 0,
          };

          if (typeof previousResult.totalScore === 'number') {
            existingTermData.totalScore += previousResult.totalScore;
            existingTermData.totalCount += 1;
          }

          if (typeof previousResult.examScore === 'number') {
            existingTermData.examScore += previousResult.examScore;
            existingTermData.examCount += 1;
          }

          publishedTermData.set(key, existingTermData);
        });

        const historicalTotals = await (prisma as any).historicalTermTotal.findMany({
          where: {
            schoolId,
            academicYearId: currentTerm.academicYear.id,
            termId: { in: previousTerms.map((term) => term.id) },
            classId: assessment.classId ?? undefined,
            studentId: { in: transformedResults.map((result) => result.pupil.id) },
          },
        });

        const historicalTotalMap = new Map<string, number>();
        historicalTotals.forEach((record: any) => {
          const subjectKey = buildSubjectKey(record.subjectId ?? null, record.subject ?? null);
          historicalTotalMap.set(`${record.studentId}:${record.termId}:${subjectKey}`, record.totalScore);
        });

        const entries = transformedResults.map((result) => {
          const subjectId = result.subjectRef?.id ?? null;
          const subjectName = result.subjectRef?.name ?? result.subject ?? 'General';
          const subjectKey = buildSubjectKey(subjectId, result.subject ?? null);

          return {
            pupilId: result.pupil.id,
            pupilName: result.pupil.name,
            admissionNo: result.pupil.admissionNo ?? null,
            subjectId,
            subjectName,
            terms: previousTerms.map((term) => {
              const publishedKey = `${result.pupil.id}:${subjectKey}:${term.sortOrder}`;
              const publishedTotals = publishedTermData.get(publishedKey);
              let totalScore: number | null = null;
              let examScore: number | null = null;

              if (publishedTotals && publishedTotals.totalCount > 0) {
                totalScore = Math.round(publishedTotals.totalScore);
                examScore = publishedTotals.examCount > 0 ? Math.round(publishedTotals.examScore) : null;
              } else {
                const historyKey = `${result.pupil.id}:${term.id}:${subjectKey}`;
                const historicalScore = historicalTotalMap.get(historyKey);
                if (typeof historicalScore === 'number') {
                  totalScore = Math.round(historicalScore);
                  examScore = null;
                }
              }

              return {
                termId: term.id,
                termName: term.name,
                sortOrder: term.sortOrder,
                totalScore,
                examScore,
              };
            }),
          };
        });

        thirdTermHistory = {
          terms: previousTerms,
          entries,
        };
      }
    }

    // Ensure publishedAt is available at the assessment level.
    const fallbackPublishedAt =
      assessment.results.find((r: any) => r.publishedAt)?.publishedAt || null;

    res.json({
      ...assessment,
      publishedAt: fallbackPublishedAt,
      results: transformedResults,
      thirdTermHistory,
    });
  } catch (error) {
    console.error('Error fetching assessment:', error);
    res.status(500).json({ error: 'Failed to fetch assessment' });
  }
});

// POST /api/admin/assessments - Create new assessment
router.post('/assessments', requireSubscription, async (req: Request, res: Response) => {
  try {
    const { name, termId, phase } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !name || !termId || !phase) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify term belongs to school
    const term = await prisma.term.findFirst({
      where: { id: termId, academicYear: { schoolId } },
    });

    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }

    const assessment = await prisma.assessment.create({
      data: {
        name,
        termId,
        phase,
        schoolId,
        status: 'DRAFT',
      },
      include: { term: true, _count: { select: { results: true } } },
    });

    res.status(201).json(assessment);
  } catch (error) {
    console.error('Error creating assessment:', error);
    res.status(500).json({ error: 'Failed to create assessment' });
  }
});

// POST /api/admin/results - Enter/update scores for students
router.post('/results', requireSubscription, async (req: Request, res: Response) => {
  try {
    const { assessmentId, entries, subject } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !assessmentId || !Array.isArray(entries)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Verify assessment belongs to school
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Cannot edit non-draft assessments' });
    }

    // Upsert results
    const results = await Promise.all(
      entries.map((entry: any) =>
        prisma.result.upsert({
          where: {
            assessmentId_pupilId_subject: {
              assessmentId,
              pupilId: entry.pupilId,
              subject: entry.subject || subject || null,
            },
          },
          update: {
            caScore: entry.caScore,
            testScore: entry.testScore,
            examScore: entry.examScore,
            totalScore: entry.totalScore,
            grade: entry.grade,
            comment: entry.comment,
          },
          create: {
            assessmentId,
            pupilId: entry.pupilId,
            subject: entry.subject || subject || null,
            caScore: entry.caScore,
            testScore: entry.testScore,
            examScore: entry.examScore,
            totalScore: entry.totalScore,
            grade: entry.grade,
            comment: entry.comment,
          },
        })
      )
    );

    res.json({ success: true, count: results.length });
  } catch (error) {
    console.error('Error updating results:', error);
    res.status(500).json({ error: 'Failed to update results' });
  }
});

// GET /api/admin/results/historical-totals - Fetch historical term totals for a class/year/subject/student
router.get('/results/historical-totals', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    const { academicYearId, termId, classId, studentId, subjectId } = req.query;

    if (!schoolId || !academicYearId || !termId || !classId) {
      return res.status(400).json({ error: 'Missing required query parameters' });
    }

    const totals = await (prisma as any).historicalTermTotal.findMany({
      where: {
        schoolId,
        academicYearId: String(academicYearId),
        termId: String(termId),
        classId: String(classId),
        studentId: studentId ? String(studentId) : undefined,
        subjectId: subjectId ? String(subjectId) : undefined,
      },
      include: {
        subjectRef: true,
      },
    });

    res.json({ success: true, totals });
  } catch (error) {
    console.error('Error fetching historical totals:', error);
    res.status(500).json({ error: 'Failed to fetch historical totals' });
  }
});

// POST /api/admin/results/historical-totals - Save or update a historical term total
router.post('/results/historical-totals', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = (await resolveSchoolId(req)) || (req as any).user?.schoolId || (req.body as any)?.schoolId || (req.headers['x-school-id'] as string | undefined);
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    const createdBy = (req as any).user?.id || 'SYSTEM';

    if (!schoolId || entries.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const records: any[] = [];

    for (const entry of entries) {
      const { academicYearId, termId, classId, studentId, subjectId, subject, totalScore } = entry;
      const entrySchoolId = entry.schoolId || schoolId;

      if (!academicYearId || !termId || !classId || !studentId || totalScore === undefined) {
        return res.status(400).json({ error: 'Missing required fields for one or more entries' });
      }

      const existing = await (prisma as any).historicalTermTotal.findFirst({
        where: {
          schoolId: entrySchoolId,
          academicYearId,
          termId,
          classId,
          studentId,
          subjectId: subjectId ?? null,
        },
      });

      const record = existing
        ? await (prisma as any).historicalTermTotal.update({
            where: { id: existing.id },
            data: {
              subject,
              totalScore,
              createdBy,
            },
          })
        : await (prisma as any).historicalTermTotal.create({
            data: {
              schoolId: entrySchoolId,
              academicYearId,
              termId,
              classId,
              studentId,
              subjectId: subjectId ?? null,
              subject: subject ?? null,
              totalScore,
              createdBy,
            },
          });

      records.push(record);
    }

    res.json({ success: true, totals: records });
  } catch (error) {
    console.error('Error saving historical total:', error);
    res.status(500).json({ error: 'Failed to save historical total' });
  }
});

// POST /api/admin/assessments/{id}/approve - Approve assessment
router.post('/assessments/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft assessments can be approved' });
    }

    const readiness = await resultsDomain.isReadyForPublish(id, schoolId);
    if (!readiness.ready) {
      return res.status(400).json({
        success: false,
        error: readiness.reason || 'Assessment must be validated before approval',
        details: { reason: readiness.reason },
      });
    }

    const updated = await prisma.assessment.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { _count: { select: { results: true } } },
    });

    res.json({
      success: true,
      message: 'Assessment approved and ready to publish',
      status: 'APPROVED',
      assessment: updated,
    });
  } catch (error) {
    console.error('Error approving assessment:', error);
    res.status(500).json({ error: 'Failed to approve assessment' });
  }
});

// POST /api/admin/assessments/{id}/publish - Publish results
router.post('/assessments/:id/publish', requireSubscription, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only approved assessments can be published' });
    }

    const userId = (req as any).user?.id || 'SYSTEM';

    // Check readiness first so we can return validation details to the client
    const readiness = await resultsDomain.isReadyForPublish(id, schoolId);
    if (!readiness.ready) {
      return res.status(400).json({ error: readiness.reason || 'Not ready to publish', details: { reason: readiness.reason } });
    }

    // Delegate to domain layer to perform publish validations, state transitions and audits
    await resultsDomain.publishResults(id, userId, schoolId);

    const updated = await prisma.assessment.findFirst({
      where: { id, schoolId },
      include: { _count: { select: { results: true } } },
    });

    res.json({
      success: true,
      message: 'Results published successfully',
      status: 'PUBLISHED',
      assessment: updated,
    });
  } catch (error) {
    console.error('Error publishing assessment:', error);
    const message = error instanceof Error ? error.message : 'Failed to publish assessment';
    res.status(500).json({ error: message, details: { stack: (error as any)?.stack } });
  }
});

// POST /api/admin/assessments/{id}/return-draft - Return to draft
router.post('/assessments/:id/return-draft', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only approved assessments can be returned to draft' });
    }

    const updated = await prisma.assessment.update({
      where: { id },
      data: { status: 'DRAFT' },
      include: { _count: { select: { results: true } } },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error returning to draft:', error);
    res.status(500).json({ error: 'Failed to return to draft' });
  }
});

// DELETE /api/admin/assessments/{id} - Safely delete assessment (DRAFT only, no results)
router.delete('/assessments/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    // Fetch assessment with related counts
    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId },
      include: {
        _count: {
          select: {
            results: true,
            resultSheets: true,
            components: true,
          },
        },
      },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Safety checks
    if (assessment.status !== 'DRAFT') {
      return res.status(400).json({
        error: 'Can only delete DRAFT assessments',
        reason: `Assessment is ${assessment.status}. Only draft assessments can be deleted.`,
      });
    }

    if (assessment._count.results > 0) {
      return res.status(400).json({
        error: 'Cannot delete assessment with results',
        reason: `This assessment has ${assessment._count.results} result(s) entered. Please delete results first.`,
      });
    }

    if (assessment._count.resultSheets > 0) {
      return res.status(400).json({
        error: 'Cannot delete assessment with result sheets',
        reason: `This assessment has result sheets. Please archive them first.`,
      });
    }

    // Delete assessment (cascade will handle components, etc.)
    const deleted = await prisma.assessment.delete({
      where: { id },
    });

    console.log(`[AUDIT] Assessment deleted by admin: ${id}, School: ${schoolId}`);

    res.json({
      success: true,
      message: `Assessment "${deleted.name}" deleted successfully`,
      deletedId: id,
    });
  } catch (error) {
    console.error('Error deleting assessment:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete assessment';
    res.status(500).json({
      error: 'Delete failed',
      message,
    });
  }
});

// ============== TEACHER MANAGEMENT ==============

// POST /api/admin/teachers - Create new teacher
router.post('/teachers', async (req: Request, res: Response) => {
  try {
    console.log('[POST /teachers] Request body:', req.body);
    
    const schoolId = await resolveSchoolId(req);
    console.log('[POST /teachers] Resolved schoolId:', schoolId);
    
    if (!schoolId) {
      console.error('[POST /teachers] Failed to resolve schoolId');
      return res.status(400).json({ error: 'School ID required' });
    }

    const { name, email, password, classIds = [], subjectIds = [] } = req.body;

    console.log('[POST /teachers] Extracted fields:', { name, email, classIds, subjectIds });

    if (!name || !email || !password) {
      console.error('[POST /teachers] Missing required fields:', { name: !!name, email: !!email, password: !!password });
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      console.error('[POST /teachers] Email already exists:', email);
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create teacher user
    console.log('[POST /teachers] Creating user with:', { name, email: email.toLowerCase().trim(), role: 'TEACHER', schoolId });
    
    const teacher = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        passwordHash,
        role: 'TEACHER',
        schoolId,
      },
    });

    console.log('[POST /teachers] User created:', teacher.id);

    // Assign to classes
    if (classIds && classIds.length > 0) {
      console.log('[POST /teachers] Assigning to classes:', classIds);
      await prisma.teacherClass.createMany({
        data: classIds.map((classId: string) => ({
          teacherId: teacher.id,
          classId,
          schoolId,
        })),
        skipDuplicates: true,
      });
    }

    // Assign to subjects
    if (subjectIds && subjectIds.length > 0) {
      console.log('[POST /teachers] Assigning to subjects:', subjectIds);
      await prisma.teacherSubject.createMany({
        data: subjectIds.map((subjectId: string) => ({
          teacherId: teacher.id,
          subjectId,
          schoolId,
        })),
        skipDuplicates: true,
      });
    }

    // Send email notification with login credentials
    try {
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true, logoUrl: true },
      });

      if (school) {
        // Send welcome email with login instructions and temp password
        await sendTeacherWelcomeEmail(
          email,
          name,
          school.name,
          password,
          'https://www.schoolbase.live/login',
          school.logoUrl ?? undefined,
        );
        console.log(`✅ Teacher welcome email sent to ${email}`);
      }
    } catch (emailError) {
      console.warn('⚠️ Failed to send teacher notification email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        role: teacher.role,
      },
      message: 'Teacher created successfully. Login credentials sent to their email.',
    });
  } catch (error) {
    console.error('Error creating teacher:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create teacher';
    res.status(500).json({ error: errorMessage });
  }
});

// PATCH /api/admin/teachers/:id - Update teacher
router.patch('/teachers/:id', async (req: Request, res: Response) => {
  try {
    console.log('[PATCH /teachers/:id] Request ID:', req.params.id);
    console.log('[PATCH /teachers/:id] Request body:', req.body);

    const schoolId = await resolveSchoolId(req);
    console.log('[PATCH /teachers/:id] Resolved schoolId:', schoolId);

    if (!schoolId) {
      console.error('[PATCH /teachers/:id] Failed to resolve schoolId');
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { name, email, password, classIds = [], subjectIds = [] } = req.body;

    // Verify teacher belongs to school
    const teacher = await prisma.user.findFirst({
      where: { id, schoolId, role: 'TEACHER' },
    });

    if (!teacher) {
      console.error('[PATCH /teachers/:id] Teacher not found:', id);
      return res.status(404).json({ error: 'Teacher not found' });
    }

    console.log('[PATCH /teachers/:id] Updating teacher:', { id, name, email });

    // Update teacher basic info
    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) {
      const trimmedEmail = email.toLowerCase().trim();
      // Check if email is already used by another user
      const existingUser = await prisma.user.findUnique({
        where: { email: trimmedEmail },
      });
      if (existingUser && existingUser.id !== id) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      updateData.email = trimmedEmail;
    }
    if (password) {
      console.log('[PATCH /teachers/:id] Updating password');
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    console.log('[PATCH /teachers/:id] User updated:', updated.id);

    // Update class assignments - delete all and recreate
    if (classIds !== undefined && Array.isArray(classIds)) {
      console.log('[PATCH /teachers/:id] Updating class assignments to:', classIds);
      // Delete existing assignments
      await prisma.teacherClass.deleteMany({
        where: { teacherId: id },
      });

      // Create new assignments
      if (classIds && classIds.length > 0) {
        await prisma.teacherClass.createMany({
          data: classIds.map((classId: string) => ({
            teacherId: id,
            classId,
            schoolId,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Update subject assignments - delete all and recreate
    if (subjectIds !== undefined && Array.isArray(subjectIds)) {
      console.log('[PATCH /teachers/:id] Updating subject assignments to:', subjectIds);
      // Delete existing assignments
      await prisma.teacherSubject.deleteMany({
        where: { teacherId: id },
      });

      // Create new assignments
      if (subjectIds && subjectIds.length > 0) {
        await prisma.teacherSubject.createMany({
          data: subjectIds.map((subjectId: string) => ({
            teacherId: id,
            subjectId,
            schoolId,
          })),
          skipDuplicates: true,
        });
      }
    }

    console.log('[PATCH /teachers/:id] Teacher updated successfully');
    res.json(updated);
  } catch (error) {
    console.error('Error updating teacher:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update teacher';
    res.status(500).json({ error: errorMessage });
  }
});

// DELETE /api/admin/teachers/:id - Delete teacher
router.delete('/teachers/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Verify teacher belongs to school
    const teacher = await prisma.user.findFirst({
      where: { id, schoolId, role: 'TEACHER' },
    });

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Delete teacher and all associations
    await prisma.user.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Teacher deleted' });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

// POST /api/admin/teachers/:id/classes - Assign teacher to class
router.post('/teachers/:id/classes', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { classId } = req.body;

    if (!classId) {
      return res.status(400).json({ error: 'Class ID required' });
    }

    // Verify teacher and class exist and belong to school
    const [teacher, cls] = await Promise.all([
      prisma.user.findFirst({ where: { id, schoolId, role: 'TEACHER' } }),
      prisma.class.findFirst({ where: { id: classId, schoolId } }),
    ]);

    if (!teacher || !cls) {
      return res.status(404).json({ error: 'Teacher or class not found' });
    }

    // Create assignment
    const assignment = await prisma.teacherClass.upsert({
      where: {
        teacherId_classId: { teacherId: id, classId },
      },
      update: {},
      create: { teacherId: id, classId, schoolId },
    });

    res.json({ success: true, assignment });
  } catch (error) {
    console.error('Error assigning teacher to class:', error);
    res.status(500).json({ error: 'Failed to assign teacher' });
  }
});

// DELETE /api/admin/teachers/:id/classes/:classId - Remove teacher from class
router.delete('/teachers/:id/classes/:classId', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id, classId } = req.params;

    // Verify teacher belongs to school
    const teacher = await prisma.user.findFirst({
      where: { id, schoolId, role: 'TEACHER' },
    });

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Delete assignment
    await prisma.teacherClass.delete({
      where: {
        teacherId_classId: { teacherId: id, classId },
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing teacher from class:', error);
    res.status(500).json({ error: 'Failed to remove teacher assignment' });
  }
});

// POST /api/admin/teachers/:id/subjects - Assign teacher to subject
router.post('/teachers/:id/subjects', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { subjectId } = req.body;

    if (!subjectId) {
      return res.status(400).json({ error: 'Subject ID required' });
    }

    // Verify teacher and subject exist and belong to school
    const [teacher, subject] = await Promise.all([
      prisma.user.findFirst({ where: { id, schoolId, role: 'TEACHER' } }),
      prisma.subject.findFirst({ where: { id: subjectId, schoolId } }),
    ]);

    if (!teacher || !subject) {
      return res.status(404).json({ error: 'Teacher or subject not found' });
    }

    // Create assignment
    const assignment = await prisma.teacherSubject.upsert({
      where: {
        teacherId_subjectId: { teacherId: id, subjectId },
      },
      update: {},
      create: { teacherId: id, subjectId, schoolId },
    });

    res.json({ success: true, assignment });
  } catch (error) {
    console.error('Error assigning teacher to subject:', error);
    res.status(500).json({ error: 'Failed to assign teacher' });
  }
});

// DELETE /api/admin/teachers/:id/subjects/:subjectId - Remove teacher from subject
router.delete('/teachers/:id/subjects/:subjectId', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id, subjectId } = req.params;

    // Verify teacher belongs to school
    const teacher = await prisma.user.findFirst({
      where: { id, schoolId, role: 'TEACHER' },
    });

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Delete assignment
    await prisma.teacherSubject.delete({
      where: {
        teacherId_subjectId: { teacherId: id, subjectId },
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing teacher from subject:', error);
    res.status(500).json({ error: 'Failed to remove teacher assignment' });
  }
});

// GET /api/admin/academic-years - Get all academic years with terms for school
router.get('/academic-years', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const academicYears = await prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      include: {
        terms: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ academicYears });
  } catch (error) {
    console.error('Error fetching academic years:', error);
    res.status(500).json({ error: 'Failed to fetch academic years' });
  }
});

// POST /api/admin/academic-years - Create new academic year
router.post('/academic-years', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { name, isCurrent } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Academic year name is required' });
    }

    // If setting as current, unset others
    if (isCurrent) {
      await prisma.academicYear.updateMany({
        where: { schoolId },
        data: { isCurrent: false },
      });
    }

    const academicYear = await prisma.academicYear.create({
      data: {
        schoolId,
        name,
        isCurrent: isCurrent || false,
      },
    });

    res.json({ success: true, academicYear });
  } catch (error) {
    console.error('Error creating academic year:', error);
    res.status(500).json({ error: 'Failed to create academic year' });
  }
});

// DELETE /api/admin/academic-years/:id - Delete academic year
router.delete('/academic-years/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Verify ownership
    const academicYear = await prisma.academicYear.findFirst({
      where: { id, schoolId },
    });

    if (!academicYear) {
      return res.status(404).json({ error: 'Academic year not found' });
    }

    await prisma.academicYear.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting academic year:', error);
    res.status(500).json({ error: 'Failed to delete academic year' });
  }
});

// POST /api/admin/terms - Create new term
router.post('/terms', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { name, academicYearId, startsOn, endsOn, sortOrder } = req.body;

    if (!name || !academicYearId) {
      return res.status(400).json({ error: 'Term name and academic year are required' });
    }

    // Verify academic year belongs to this school
    const academicYear = await prisma.academicYear.findFirst({
      where: { id: academicYearId, schoolId },
    });

    if (!academicYear) {
      return res.status(404).json({ error: 'Academic year not found' });
    }

    const term = await prisma.term.create({
      data: {
        name,
        academicYearId,
        startsOn: startsOn ? new Date(startsOn) : null,
        endsOn: endsOn ? new Date(endsOn) : null,
        sortOrder: sortOrder || 1,
      },
    });

    res.json({ term });
  } catch (error) {
    console.error('Error creating term:', error);
    res.status(500).json({ error: 'Failed to create term' });
  }
});

// PATCH /api/admin/terms/:id - Update term
router.patch('/terms/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { name, startsOn, endsOn, sortOrder } = req.body;

    // Verify term belongs to this school
    const term = await prisma.term.findFirst({
      where: {
        id,
        academicYear: { schoolId },
      },
    });

    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }

    const updated = await prisma.term.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(startsOn !== undefined && { startsOn: startsOn ? new Date(startsOn) : null }),
        ...(endsOn !== undefined && { endsOn: endsOn ? new Date(endsOn) : null }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ term: updated });
  } catch (error) {
    console.error('Error updating term:', error);
    res.status(500).json({ error: 'Failed to update term' });
  }
});

// DELETE /api/admin/terms/:id - Delete term
router.delete('/terms/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Verify term belongs to this school
    const term = await prisma.term.findFirst({
      where: {
        id,
        academicYear: { schoolId },
      },
    });

    if (!term) {
      return res.status(404).json({ error: 'Term not found' });
    }

    await prisma.term.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting term:', error);
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

// POST /api/admin/academic-years/:id/set-current - Set academic year as current
router.post('/academic-years/:id/set-current', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Verify academic year belongs to this school
    const academicYear = await prisma.academicYear.findFirst({
      where: { id, schoolId },
    });

    if (!academicYear) {
      return res.status(404).json({ error: 'Academic year not found' });
    }

    // Unset all current academic years for this school
    await prisma.academicYear.updateMany({
      where: { schoolId },
      data: { isCurrent: false },
    });

    // Set the selected one as current
    const updated = await prisma.academicYear.update({
      where: { id },
      data: { isCurrent: true },
    });

    res.json({ academicYear: updated });
  } catch (error) {
    console.error('Error setting current academic year:', error);
    res.status(500).json({ error: 'Failed to set current academic year' });
  }
});

// POST /api/admin/request-password-reset - Request password reset
router.post('/request-password-reset', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      // Don't reveal if email exists for security
      return res.json({ success: true, message: 'If email exists, reset link has been sent' });
    }

    // Generate reset token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save to database
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    // Send email
    const resetLink = `${process.env.FRONTEND_URL || 'https://www.schoolbase.live'}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
    await sendPasswordResetEmail(user.email, resetLink, user.name || 'User');

    res.json({ success: true, message: 'If email exists, reset link has been sent' });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// POST /api/admin/reset-password - Reset password with token
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { email, token, password } = req.body;

    if (!email || !token || !password) {
      return res.status(400).json({ error: 'Email, token, and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { email: String(email).trim().toLowerCase() },
      select: { id: true, email: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or token' });
    }

    // Find valid reset token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        tokenHash,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (!resetRecord) {
      return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    // Check attempts
    if (resetRecord.attempts > 5) {
      return res.status(429).json({ error: 'Too many attempts. Please request a new reset link' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user and mark token as used
    await Promise.all([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      prisma.passwordReset.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// GET /api/admin/announcements - Get recent announcements for dashboard
router.get('/announcements', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const announcements = await prisma.announcement.findMany({
      where: { schoolId },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });

    res.json({ announcements });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// POST /api/admin/announcements - Create new announcement
router.post('/announcements', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { title, body, publish } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body are required' });
    }

    const announcement = await prisma.announcement.create({
      data: {
        schoolId,
        title,
        body,
        published: publish === true || publish === 'true',
        publishedAt: (publish === true || publish === 'true') ? new Date() : null,
      },
    });

    let sentCount = 0;
    const errors: string[] = [];

    if (announcement.published) {
      const guardians = await prisma.guardian.findMany({
        where: {
          pupils: { some: { pupil: { schoolId } } },
        },
        select: {
          id: true,
          firstName: true,
          whatsapp: true,
          phone: true,
          email: true,
        },
        orderBy: { lastName: 'asc' },
      });

      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true, logoUrl: true },
      });
      const communicationService = createCommunicationService();
      const message = `Dear parent, a new school announcement has been published: ${title}. ${body}`;

      for (const guardian of guardians) {
        const whatsappAddress = guardian.whatsapp || guardian.phone;
        const recipients = [
          ...(guardian.email ? [{ channel: 'EMAIL' as const, address: guardian.email, name: guardian.firstName }] : []),
          ...(whatsappAddress ? [{ channel: 'WHATSAPP' as const, address: whatsappAddress, name: guardian.firstName }] : []),
        ];

        if (recipients.length === 0) {
          continue;
        }

        try {
          const dispatchResult = await communicationService.dispatch({
            event: 'AnnouncementCreated',
            schoolId,
            recipients,
            template: 'Announcement',
            subject: `School Announcement: ${title}`,
            body: message,
            data: {
              title,
              message: body,
              schoolName: school?.name || 'SchoolBase',
              recipientName: guardian.firstName,
            },
            metadata: {
              title,
              message: body,
              schoolName: school?.name || 'SchoolBase',
              logoUrl: school?.logoUrl ?? undefined,
              announcementId: announcement.id,
              guardianId: guardian.id,
            },
          });

          for (const delivery of dispatchResult.deliveries) {
            const status = delivery.status === 'SENT' ? 'SENT' : delivery.status === 'QUEUED' ? 'PENDING' : 'FAILED';
            await prisma.notification.create({
              data: {
                schoolId,
                guardianId: guardian.id,
                type: 'ANNOUNCEMENT',
                title: `School Announcement: ${title}`,
                body: truncateNotificationBody(message),
                channel: delivery.channel,
                status,
                sentAt: delivery.status === 'SENT' || delivery.status === 'QUEUED' ? new Date() : undefined,
                failureReason: delivery.error,
                relatedId: announcement.id,
                reference: String(announcement.id),
              },
            });

            if (status !== 'FAILED') {
              sentCount++;
            }
          }
        } catch (err) {
          errors.push(`Failed to dispatch announcement for guardian ${guardian.id}`);
          await prisma.notification.create({
            data: {
              schoolId,
              guardianId: guardian.id,
              type: 'ANNOUNCEMENT',
              title: `School Announcement: ${title}`,
              body: truncateNotificationBody(message),
              channel: whatsappAddress ? 'WHATSAPP' : 'EMAIL',
              status: 'FAILED',
              failureReason: err instanceof Error ? err.message : String(err),
              relatedId: announcement.id,
              reference: String(announcement.id),
            },
          });
        }
      }
    }

    res.status(201).json({ 
      success: true, 
      announcement,
      sentCount,
      errors: errors.length > 0 ? errors : undefined,
      message: 'Announcement created successfully' 
    });
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// PATCH /api/admin/announcements/:id - Update announcement
router.patch('/announcements/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { title, body, publish } = req.body;

    // Verify announcement belongs to school
    const announcement = await prisma.announcement.findFirst({
      where: { id, schoolId },
    });

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (body !== undefined) updateData.body = body;
    if (publish !== undefined) {
      const shouldPublish = publish === true || publish === 'true';
      updateData.published = shouldPublish;
      if (shouldPublish && !announcement.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: updateData,
    });

    res.json({ 
      success: true, 
      announcement: updated,
      message: 'Announcement updated successfully'
    });
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// DELETE /api/admin/announcements/:id - Delete announcement
router.delete('/announcements/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;

    // Verify announcement belongs to school
    const announcement = await prisma.announcement.findFirst({
      where: { id, schoolId },
    });

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    await prisma.announcement.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// GET /api/admin/payments/recent - Get recent payments for dashboard
router.get('/payments/recent', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const payments = await prisma.payment.findMany({
      where: { invoice: { schoolId } },
      include: {
        invoice: {
          include: {
            pupil: { include: { class: true } },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
      take: 5,
    });

    res.json({ payments });
  } catch (error) {
    console.error('Error fetching recent payments:', error);
    res.status(500).json({ error: 'Failed to fetch recent payments' });
  }
});

// GET /api/admin/videos - Get video tutorials from database
router.get('/videos', async (req: Request, res: Response) => {
  try {
    const videos = await prisma.videoTutorial.findMany({
      orderBy: [
        { featured: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({ videos });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// GET /api/admin/videos/:id - Get a specific video tutorial
router.get('/videos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const video = await prisma.videoTutorial.findUnique({
      where: { id }
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ video });
  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// ============== CLASSES MANAGEMENT ==============

// POST /api/admin/classes - Create new class
router.post('/classes', async (req: Request, res: Response) => {
  try {
    const { name, phase, arm } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !name || !phase) {
      return res.status(400).json({ error: 'Missing required fields: name, phase' });
    }

    if (!['EARLY_YEARS', 'PRIMARY', 'SECONDARY'].includes(phase)) {
      return res.status(400).json({ error: 'Invalid phase. Must be EARLY_YEARS, PRIMARY, or SECONDARY' });
    }

    const newClass = await prisma.class.create({
      data: {
        schoolId,
        name,
        phase,
        arm: arm || null,
      },
      include: {
        _count: {
          select: { pupils: true, subjectClasses: true }
        }
      }
    });

    res.status(201).json(newClass);
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// PATCH /api/admin/classes/:id - Update class
router.patch('/classes/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, phase, arm } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    // Verify class belongs to school
    const classItem = await prisma.class.findFirst({
      where: { id, schoolId }
    });

    if (!classItem) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phase !== undefined) {
      if (!['EARLY_YEARS', 'PRIMARY', 'SECONDARY'].includes(phase)) {
        return res.status(400).json({ error: 'Invalid phase' });
      }
      updateData.phase = phase;
    }
    if (arm !== undefined) updateData.arm = arm || null;

    const updated = await prisma.class.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { pupils: true, subjectClasses: true }
        }
      }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// DELETE /api/admin/classes/:id - Delete class
router.delete('/classes/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    // Verify class belongs to school
    const classItem = await prisma.class.findFirst({
      where: { id, schoolId },
      include: { _count: { select: { pupils: true } } }
    });

    if (!classItem) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if ((classItem as any)._count.pupils > 0) {
      return res.status(400).json({ error: 'Cannot delete class with students. Please remove all students first.' });
    }

    await prisma.class.delete({ where: { id } });

    res.json({ success: true, message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

// ============== SUBJECTS MANAGEMENT ==============

// POST /api/admin/subjects - Create new subject
router.post('/subjects', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !name) {
      return res.status(400).json({ error: 'Missing required fields: name' });
    }

    // Check if subject with same name already exists for this school
    const existing = await prisma.subject.findFirst({
      where: { schoolId, name }
    });

    if (existing) {
      return res.status(400).json({ error: 'Subject with this name already exists in your school' });
    }

    const newSubject = await prisma.subject.create({
      data: {
        schoolId,
        name,
      }
    });

    res.status(201).json(newSubject);
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

// PATCH /api/admin/subjects/:id - Update subject
router.patch('/subjects/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    // Verify subject belongs to school
    const subject = await prisma.subject.findFirst({
      where: { id, schoolId }
    });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    if (name) {
      // Check if new name conflicts with existing subject
      const existing = await prisma.subject.findFirst({
        where: { schoolId, name, NOT: { id } }
      });

      if (existing) {
        return res.status(400).json({ error: 'Subject with this name already exists' });
      }
    }

    const updated = await prisma.subject.update({
      where: { id },
      data: { name: name || undefined }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

// DELETE /api/admin/subjects/:id - Delete subject
router.delete('/subjects/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    // Verify subject belongs to school
    const subject = await prisma.subject.findFirst({
      where: { id, schoolId }
    });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Delete all associations before deleting subject
    await prisma.subjectClass.deleteMany({ where: { subjectId: id } });
    await prisma.teacherSubject.deleteMany({ where: { subjectId: id } });

    await prisma.subject.delete({ where: { id } });

    res.json({ success: true, message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

// POST /api/admin/class-subjects/:classId/:subjectId - Assign subject to class
router.post('/class-subjects/:classId/:subjectId', async (req: Request, res: Response) => {
  try {
    const { classId, subjectId } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    // Verify both class and subject belong to school
    const [classItem, subject] = await Promise.all([
      prisma.class.findFirst({ where: { id: classId, schoolId } }),
      prisma.subject.findFirst({ where: { id: subjectId, schoolId } })
    ]);

    if (!classItem) {
      return res.status(404).json({ error: 'Class not found' });
    }

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Check if assignment already exists
    const existing = await prisma.subjectClass.findFirst({
      where: { classId, subjectId }
    });

    if (existing) {
      return res.status(400).json({ error: 'Subject already assigned to this class' });
    }

    const assignment = await prisma.subjectClass.create({
      data: {
        schoolId,
        classId,
        subjectId,
      },
      include: { class: true, subject: true }
    });

    res.status(201).json(assignment);
  } catch (error) {
    console.error('Error assigning subject to class:', error);
    res.status(500).json({ error: 'Failed to assign subject' });
  }
});

// DELETE /api/admin/class-subjects/:classId/:subjectId - Remove subject from class
router.delete('/class-subjects/:classId/:subjectId', async (req: Request, res: Response) => {
  try {
    const { classId, subjectId } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const assignment = await prisma.subjectClass.findFirst({
      where: { classId, subjectId, schoolId }
    });

    if (!assignment) {
      return res.status(404).json({ error: 'Subject assignment not found' });
    }

    await prisma.subjectClass.delete({ where: { id: assignment.id } });

    res.json({ success: true, message: 'Subject removed from class' });
  } catch (error) {
    console.error('Error removing subject from class:', error);
    res.status(500).json({ error: 'Failed to remove subject' });
  }
});

// GET /api/admin/attendance/data - Get attendance records for class and date
router.get('/attendance/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { classId, date } = req.query;
    if (!classId || !date) {
      return res.status(400).json({ error: 'classId and date required' });
    }

    // Parse date as ISO string
    const attendanceDate = new Date(date as string);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Get all pupils in the class
    const pupils = await prisma.pupil.findMany({
      where: { schoolId, classId: classId as string, isActive: true },
      include: { guardians: { include: { guardian: true } } },
      orderBy: { lastName: 'asc' },
    });

    // Get attendance records for this date
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        schoolId,
        classId: classId as string,
        date: attendanceDate,
      },
    });

    // Create map for quick lookup
    const attendanceMap: { [key: string]: string } = {};
    attendanceRecords.forEach((record) => {
      attendanceMap[record.pupilId] = record.status;
    });

    // Build response with pupils and their attendance status
    const attendanceData = pupils.map((pupil) => ({
      pupilId: pupil.id,
      name: `${pupil.firstName} ${pupil.lastName}`,
      status: attendanceMap[pupil.id] || 'PRESENT',
      guardians: pupil.guardians.map((gp) => ({
        id: gp.guardian.id,
        name: gp.guardian.firstName,
        phone: gp.guardian.whatsapp || gp.guardian.phone,
        email: gp.guardian.email,
      })),
    }));

    const classData = await prisma.class.findUnique({
      where: { id: classId as string },
      select: { name: true, arm: true },
    });

    res.json({
      date: attendanceDate.toISOString().split('T')[0],
      classId,
      className: classData ? `${classData.name} ${classData.arm || ''}` : 'Unknown',
      pupils: attendanceData,
      totalPupils: pupils.length,
      presentCount: attendanceRecords.filter((r) => r.status === 'PRESENT').length,
      absentCount: attendanceRecords.filter((r) => r.status === 'ABSENT').length,
      lateCount: attendanceRecords.filter((r) => r.status === 'LATE').length,
    });
  } catch (error) {
    console.error('Error fetching attendance data:', error);
    res.status(500).json({ error: 'Failed to fetch attendance data' });
  }
});

// POST /api/admin/attendance/mark - Mark attendance for students
router.post('/attendance/mark', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { classId, date, attendance } = req.body;
    if (!classId || !date || !attendance) {
      return res.status(400).json({ error: 'classId, date, and attendance array required' });
    }

    // Parse date
    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Validate attendance statuses
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE'];
    for (const att of attendance) {
      if (!validStatuses.includes(att.status)) {
        return res.status(400).json({ error: `Invalid status: ${att.status}` });
      }
    }

    // Delete existing records for this date and class
    await prisma.attendanceRecord.deleteMany({
      where: {
        schoolId,
        classId,
        date: attendanceDate,
      },
    });

    // Create new attendance records
    const records = await Promise.all(
      attendance.map((att: { pupilId: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | string }) =>
        prisma.attendanceRecord.create({
          data: {
            schoolId,
            classId,
            pupilId: att.pupilId,
            date: attendanceDate,
            status: att.status as 'PRESENT' | 'ABSENT' | 'LATE',
          },
        })
      )
    );

    res.status(201).json({
      success: true,
      message: `Marked attendance for ${records.length} students`,
      recordsCreated: records.length,
    });
  } catch (error) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// GET /api/admin/attendance/summary - Get attendance summary and reports
router.get('/attendance/summary', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { classId, fromDate, toDate, pupilId } = req.query;

    // Build where clause
    let whereClause: any = { schoolId };
    if (classId) whereClause.classId = classId;
    if (pupilId) whereClause.pupilId = pupilId;

    if (fromDate && toDate) {
      const from = new Date(fromDate as string);
      const to = new Date(toDate as string);
      from.setUTCHours(0, 0, 0, 0);
      to.setUTCHours(23, 59, 59, 999);
      whereClause.date = { gte: from, lte: to };
    }

    const records = await prisma.attendanceRecord.findMany({
      where: whereClause,
      include: {
        pupil: { select: { id: true, firstName: true, lastName: true } },
        class: { select: { id: true, name: true } },
      },
      orderBy: { date: 'desc' },
    });

    // Calculate statistics
    const stats = {
      totalRecords: records.length,
      presentCount: records.filter((r) => r.status === 'PRESENT').length,
      absentCount: records.filter((r) => r.status === 'ABSENT').length,
      lateCount: records.filter((r) => r.status === 'LATE').length,
    };

    // Group by pupil for per-pupil stats
    const pupilStats: { [key: string]: any } = {};
    records.forEach((record) => {
      if (!pupilStats[record.pupilId]) {
        pupilStats[record.pupilId] = {
          pupilId: record.pupilId,
          name: `${record.pupil.firstName} ${record.pupil.lastName}`,
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
          attendanceRate: 0,
        };
      }
      pupilStats[record.pupilId].total++;
      if (record.status === 'PRESENT') pupilStats[record.pupilId].present++;
      if (record.status === 'ABSENT') pupilStats[record.pupilId].absent++;
      if (record.status === 'LATE') pupilStats[record.pupilId].late++;
    });

    // Calculate attendance rates
    Object.values(pupilStats).forEach((stat: any) => {
      stat.attendanceRate = stat.total > 0 ? ((stat.present + stat.late * 0.5) / stat.total) * 100 : 0;
    });

    res.json({
      summary: stats,
      pupilStatistics: Object.values(pupilStats),
      records,
    });
  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    res.status(500).json({ error: 'Failed to fetch attendance summary' });
  }
});

// POST /api/admin/attendance/notify - Send attendance notifications
router.post('/attendance/notify', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { classId, date, notificationType, customMessage } = req.body;
    if (!classId || !date) {
      return res.status(400).json({ error: 'classId and date required' });
    }

    // Parse date
    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Get attendance records for this date
    const records = await prisma.attendanceRecord.findMany({
      where: { schoolId, classId, date: attendanceDate },
      include: {
        pupil: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            class: { select: { name: true } },
            guardians: { include: { guardian: true } },
          },
        },
      },
    });

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true, logoUrl: true, currency: true },
    });

    let sentCount = 0;
    const errors: string[] = [];

    // Send notifications to guardians
    for (const record of records) {
      const pupilName = `${record.pupil.firstName} ${record.pupil.lastName}`;
      let message = '';

      if (notificationType === 'ABSENT' && record.status === 'ABSENT') {
        message = customMessage || `Dear Guardian, ${pupilName} was absent from school on ${date}. Please contact the school for more information.`;
      } else if (notificationType === 'LATE' && record.status === 'LATE') {
        message = customMessage || `Dear Guardian, ${pupilName} arrived late to school on ${date}.`;
      } else if (notificationType === 'ALL') {
        const statusMsg = record.status === 'PRESENT' ? 'present' : record.status === 'ABSENT' ? 'absent' : 'arrived late';
        message = customMessage || `Attendance Update: ${pupilName} was ${statusMsg} on ${date}.`;
      } else {
        continue;
      }

      // Send to all guardians
      for (const guardianPupil of record.pupil.guardians) {
        const guardian = guardianPupil.guardian;

        // Try WhatsApp if available
        if (guardian.whatsapp) {
          try {
            const result = await baileysSessionManager.sendTextMessage(schoolId, guardian.whatsapp, message);
            if (result.success) {
              sentCount++;
            } else {
              errors.push(`WhatsApp failed for ${guardian.whatsapp}: ${result.error}`);
            }
          } catch (err) {
            errors.push(`WhatsApp failed for ${guardian.whatsapp}`);
          }
        } else if (guardian.email) {
          // Send email
          try {
            const className = record.pupil.class?.name || 'Unknown Class';
            const status = record.status.toLowerCase() as 'present' | 'absent' | 'late';
            await sendAttendanceNotificationEmail(
              guardian.email,
              guardian.firstName,
              pupilName,
              className,
              date,
              status,
              school?.name || 'School',
              message,
              school?.logoUrl ?? undefined,
            );
            sentCount++;
          } catch (err) {
            errors.push(`Email failed for ${guardian.email}`);
          }
        }
      }
    }

    res.json({
      success: true,
      sent: sentCount,
      total: records.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error sending attendance notifications:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// GET /api/admin/guardians - Get all guardians for school
router.get('/guardians', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const guardians = await prisma.guardian.findMany({
      where: {
        pupils: {
          some: {
            pupil: { schoolId },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        whatsapp: true,
        email: true,
      },
      orderBy: { lastName: 'asc' },
    });

    const mappedGuardians = guardians.map((g) => ({
      id: g.id,
      name: `${g.firstName} ${g.lastName}`,
      phone: g.whatsapp || g.phone,
      email: g.email,
      role: 'Guardian',
    }));

    res.json({ guardians: mappedGuardians });
  } catch (error) {
    console.error('Error fetching guardians:', error);
    res.status(500).json({ error: 'Failed to fetch guardians' });
  }
});

// POST /api/admin/whatsapp/send-message - Send WhatsApp message to guardian
router.post('/whatsapp/send-message', requireSubscription, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const { phoneNumber, message, recipientName } = req.body;
    if (!phoneNumber || !message) {
      return res.status(400).json({ error: 'phoneNumber and message required' });
    }

    const result = await baileysSessionManager.sendTextMessage(schoolId, phoneNumber, message);

    res.json({
      success: result.success,
      message: result.success ? `Message sent to ${recipientName}` : `Message failed for ${recipientName}`,
      status: result.success ? 'sent' : 'failed',
      error: result.error,
    });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
});

// POST /api/admin/seed/defaults/:schoolId
// Seed default grading scales for a school
router.post('/seed/defaults/:schoolId', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;
    const { ensureGradingScales = true, ensureAssessmentConfig = false, assessmentId } = req.body;

    // Verify school exists
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const results: any = {};

    // Seed grading scales if requested
    if (ensureGradingScales) {
      const existingScales = await prisma.gradingScale.findMany({
        where: { schoolId },
      });

      if (existingScales.length === 0) {
        const defaultScales = [
          { grade: 'A', minScore: 70, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 69 },
          { grade: 'C', minScore: 50, maxScore: 59 },
          { grade: 'D', minScore: 45, maxScore: 49 },
          { grade: 'E', minScore: 40, maxScore: 44 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ];

        for (const scale of defaultScales) {
          await prisma.gradingScale.create({
            data: { schoolId, ...scale },
          });
        }

        results.gradingScalesCreated = defaultScales.length;
      } else {
        results.gradingScalesExisted = existingScales.length;
      }
    }

    // Seed assessment configuration if requested
    if (ensureAssessmentConfig && assessmentId) {
      const assessment = await prisma.assessment.findFirst({
        where: { id: assessmentId, schoolId },
      });

      if (!assessment) {
        return res.status(404).json({ error: 'Assessment not found' });
      }

      if (!assessment.componentData) {
        const defaultConfig = {
          components: [
            {
              id: 'comp-ca',
              name: 'Continuous Assessment',
              maxScore: 20,
              weight: 20,
              sortOrder: 1,
            },
            {
              id: 'comp-test',
              name: 'Test',
              maxScore: 20,
              weight: 20,
              sortOrder: 2,
            },
            {
              id: 'comp-exam',
              name: 'Examination',
              maxScore: 60,
              weight: 60,
              sortOrder: 3,
            },
          ],
        };

        await prisma.assessment.update({
          where: { id: assessmentId },
          data: { componentData: JSON.stringify(defaultConfig) },
        });

        results.assessmentConfigured = true;
      } else {
        results.assessmentAlreadyConfigured = true;
      }
    }

    res.json({
      success: true,
      message: 'Defaults seeded successfully',
      schoolId,
      results,
    });
  } catch (error) {
    console.error('Error seeding defaults:', error);
    res.status(500).json({ error: 'Failed to seed defaults' });
  }
});

// GET /api/admin/subjects - Get all subjects for the school
router.get('/subjects', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    const subjects = await prisma.subject.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({ subjects });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// GET /api/admin/subscription/status - Get subscription status and details
router.get('/subscription/status', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        status: true,
        plan: true,
        trialEndsAt: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Determine subscription status
    const now = new Date();
    let subscriptionStatus = 'UNKNOWN';
    let daysRemaining = 0;
    let message = '';

    if (school.status === 'ACTIVE') {
      if (school.subscriptionExpiresAt) {
        const expiryDate = new Date(school.subscriptionExpiresAt);
        daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysRemaining > 0) {
          subscriptionStatus = 'ACTIVE';
          message = `Your ${school.plan} plan is active`;
        } else {
          subscriptionStatus = 'EXPIRED';
          message = 'Your subscription has expired';
        }
      } else {
        subscriptionStatus = 'ACTIVE';
        message = `Your ${school.plan} plan is active`;
      }
    } else if (school.status === 'TRIAL') {
      if (school.trialEndsAt) {
        const trialEndDate = new Date(school.trialEndsAt);
        daysRemaining = Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysRemaining > 0) {
          subscriptionStatus = 'TRIAL';
          message = `Free trial in progress - ${daysRemaining} days remaining`;
        } else {
          subscriptionStatus = 'TRIAL_EXPIRED';
          message = 'Your free trial has expired';
        }
      } else {
        subscriptionStatus = 'TRIAL';
        message = 'Free trial in progress';
      }
    } else if (school.status === 'SUSPENDED') {
      subscriptionStatus = 'SUSPENDED';
      message = 'Your subscription has been suspended';
    } else if (school.status === 'CANCELLED') {
      subscriptionStatus = 'CANCELLED';
      message = 'Your subscription has been cancelled';
    } else if (school.status === 'PENDING') {
      subscriptionStatus = 'PENDING';
      message = 'Your subscription is pending approval';
    }

    res.json({
      subscriptionStatus,
      schoolName: school.name,
      currentPlan: school.plan,
      status: school.status,
      trialEndsAt: school.trialEndsAt,
      subscriptionExpiresAt: school.subscriptionExpiresAt,
      daysRemaining,
      message,
      canRenew: ['EXPIRED', 'TRIAL_EXPIRED', 'CANCELLED'].includes(subscriptionStatus),
      canUpgrade: subscriptionStatus === 'ACTIVE' && ['STARTER', 'GROWTH'].includes(school.plan),
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

// POST /api/admin/send-trial-emails - Send subscription emails to all trial accounts
router.post('/send-trial-emails', async (req: Request, res: Response) => {
  try {
    console.log('[Trial Emails] Starting to send subscription emails to trial accounts...');

    // Find all TRIAL schools
    const trialSchools = await prisma.school.findMany({
      where: {
        status: 'TRIAL',
      },
      select: {
        id: true,
        name: true,
        plan: true,
        trialEndsAt: true,
      },
    });

    console.log(`[Trial Emails] Found ${trialSchools.length} trial schools`);

    const results = {
      total: trialSchools.length,
      sent: 0,
      failed: 0,
      details: [] as Array<{ schoolName: string; adminEmail: string; status: string; error?: string }>,
    };

    for (const school of trialSchools) {
      try {
        // Find the admin user for this school
        const admin = await prisma.user.findFirst({
          where: {
            schoolId: school.id,
            role: 'SCHOOL_ADMIN',
          },
          select: { email: true, name: true },
        });

        if (!admin?.email) {
          console.warn(`[Trial Emails] No admin email found for school: ${school.name}`);
          results.failed++;
          results.details.push({
            schoolName: school.name,
            adminEmail: 'N/A',
            status: 'failed',
            error: 'No admin email found',
          });
          continue;
        }

        // Format the trial end date
        const trialEndDate = school.trialEndsAt
          ? new Date(school.trialEndsAt).toLocaleDateString('en-NG', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'N/A';

        // Send subscription email
        await sendSubscriptionPaymentSuccessEmail(
          admin.email,
          school.name,
          admin.name || 'Admin',
          school.plan || 'STARTER',
          'Trial Access',
          trialEndDate
        );

        console.log(`[Trial Emails] Email sent successfully to ${admin.email} for school: ${school.name}`);
        results.sent++;
        results.details.push({
          schoolName: school.name,
          adminEmail: admin.email,
          status: 'sent',
        });
      } catch (emailError) {
        console.error(`[Trial Emails] Error sending email for school ${school.name}:`, emailError);
        results.failed++;
        results.details.push({
          schoolName: school.name,
          adminEmail: 'unknown',
          status: 'failed',
          error: emailError instanceof Error ? emailError.message : 'Unknown error',
        });
      }
    }

    console.log('[Trial Emails] Completed. Summary:', results);
    res.json({
      success: true,
      message: `Sent subscription emails to ${results.sent} trial accounts (${results.failed} failed)`,
      results,
    });
  } catch (error) {
    console.error('[Trial Emails] Error in send-trial-emails endpoint:', error);
    res.status(500).json({
      error: 'Failed to send trial account emails',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
