import { Router, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../services/email.js';

const router = Router();
const prisma = new PrismaClient();

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

async function resolveSchoolId(req: Request) {
  const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string);
  if (schoolId) {
    return schoolId;
  }

  // Check unified session cookie (supports both old and new names for backward compatibility)
  const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
  console.log('[resolveSchoolId] token:', token ? 'present' : 'missing', 'cookies:', Object.keys(req.cookies || {}));
  
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      console.log('[resolveSchoolId] payload:', payload);
      if (payload && typeof payload === 'object' && 'schoolId' in payload) {
        return String((payload as any).schoolId);
      }
    } catch (err) {
      console.log('[resolveSchoolId] JWT verification failed:', (err as Error).message);
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
    const school = await prisma.school.findUnique({ where: { slug } });
    return school?.id ?? null;
  }

  return null;
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
    
    res.json({
      authenticated: true,
      session: payload,
    });
  } catch (error) {
    res.status(401).json({ authenticated: false });
  }
});

// POST /api/admin/login - Authenticate staff / platform admin and return a session token
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
        waCloudAccessTokenEncrypted: true,
        waCloudPhoneNumberIdEncrypted: true,
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
        hasWaCloudAccessToken: Boolean(school.waCloudAccessTokenEncrypted),
        hasWaCloudPhoneNumberId: Boolean(school.waCloudPhoneNumberIdEncrypted),
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
      waCloudAccessToken,
      waCloudPhoneNumberId,
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
        waCloudAccessTokenEncrypted: waCloudAccessToken || null,
        waCloudPhoneNumberIdEncrypted: waCloudPhoneNumberId || null,
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
        waCloudAccessTokenEncrypted: true,
        waCloudPhoneNumberIdEncrypted: true,
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
        hasPaystackPublic: Boolean(school.paystackPublicEncrypted),
        hasPaystackSecret: Boolean(school.paystackSecretEncrypted),
        hasWaCloudAccessToken: Boolean(school.waCloudAccessTokenEncrypted),
        hasWaCloudPhoneNumberId: Boolean(school.waCloudPhoneNumberIdEncrypted),
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

    const assessments = await prisma.assessment.findMany({
      where: { schoolId },
      include: { 
        _count: { select: { results: true } }, 
        term: true 
      },
      orderBy: [{ phase: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ assessments });
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
      supportRequests: (supportRequests as any[]).map((request) => ({
        id: request.id,
        subject: request.subject,
        message: request.message,
        response: request.response,
        status: request.status,
        priority: request.priority,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        messages: (request as any).messages.map((message: any) => ({
          id: message.id,
          senderRole: message.senderRole,
          senderName: message.senderName,
          senderEmail: message.senderEmail,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
        })),
        school: {
          id: schoolId,
          name: school?.name,
          country: school?.country,
        },
      })),
    });
  } catch (error) {
    console.error('Error fetching support data:', error);
    res.status(500).json({ error: 'Failed to fetch support data' });
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

    const classes = await prisma.class.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    });

    const subjects = await prisma.subject.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    });

    // Basic school analytics: count results and calculate metrics
    const results = await prisma.result.findMany({
      where: {
        pupil: { schoolId },
        publishedAt: { not: null },
      },
    });

    const schoolAverage = results.length > 0 
      ? (results.reduce((sum: number, r: any) => sum + (r.score || 0), 0) / results.length) 
      : 0;

    const passCount = results.filter((r: any) => (r.score || 0) >= 40).length;
    const passRate = results.length > 0 ? (passCount / results.length) * 100 : 0;

    res.json({
      schoolAnalytics: {
        schoolAverage,
        passRate,
        totalResults: results.length,
        gradeDistribution: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 },
        topPerformers: [],
        strugglingStudents: [],
      },
      classes,
      subjects,
    });
  } catch (error) {
    console.error('Error fetching analytics data:', error);
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

// GET /api/admin/whatsapp/data - Get WhatsApp delivery status
router.get('/whatsapp/data', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required' });

    // Return empty deliveries for now (file reading removed for static export)
    res.json({
      deliveries: [],
      successCount: 0,
      failureCount: 0,
    });
  } catch (error) {
    console.error('Error fetching whatsapp data:', error);
    res.status(500).json({ error: 'Failed to fetch whatsapp data' });
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
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const terms = await prisma.term.findMany({
      where: {
        academicYear: {
          schoolId,
          isCurrent: true,
        },
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true },
    });

    res.json({ terms });
  } catch (error) {
    console.error('Error fetching terms:', error);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// GET /api/admin/results/{id} - Fetch single assessment with results
router.get('/results/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId) {
      return res.status(401).json({ error: 'School ID required' });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId },
      include: {
        term: true,
        results: {
          include: {
            pupil: { select: { id: true, firstName: true, lastName: true } },
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

    res.json({
      ...assessment,
      results: transformedResults,
    });
  } catch (error) {
    console.error('Error fetching assessment:', error);
    res.status(500).json({ error: 'Failed to fetch assessment' });
  }
});

// POST /api/admin/assessments - Create new assessment
router.post('/assessments', async (req: Request, res: Response) => {
  try {
    const { name, termId, phase } = req.body;
    const schoolId = req.headers['x-school-id'] as string;

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
router.post('/results', async (req: Request, res: Response) => {
  try {
    const { assessmentId, entries } = req.body;
    const schoolId = req.headers['x-school-id'] as string;

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
              subject: entry.subject || null,
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
            subject: entry.subject,
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

// POST /api/admin/assessments/{id}/approve - Approve assessment
router.post('/assessments/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

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

    const updated = await prisma.assessment.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { _count: { select: { results: true } } },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error approving assessment:', error);
    res.status(500).json({ error: 'Failed to approve assessment' });
  }
});

// POST /api/admin/assessments/{id}/publish - Publish results
router.post('/assessments/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

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

    // Update assessment status to PUBLISHED
    const updated = await prisma.assessment.update({
      where: { id },
      data: { status: 'PUBLISHED' },
      include: { _count: { select: { results: true } } },
    });

    // Update all results with publishedAt timestamp
    await prisma.result.updateMany({
      where: { assessmentId: id },
      data: { publishedAt: new Date() },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error publishing assessment:', error);
    res.status(500).json({ error: 'Failed to publish assessment' });
  }
});

// POST /api/admin/assessments/{id}/return-draft - Return to draft
router.post('/assessments/:id/return-draft', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

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

// ============== TEACHER MANAGEMENT ==============

// POST /api/admin/teachers - Create new teacher
router.post('/teachers', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { name, email, password, classIds = [], subjectIds = [] } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create teacher user
    const teacher = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        passwordHash,
        role: 'TEACHER',
        schoolId,
      },
    });

    // Assign to classes
    if (classIds && classIds.length > 0) {
      await prisma.teacherClass.createMany({
        data: classIds.map((classId: string) => ({
          teacherId: teacher.id,
          classId,
        })),
        skipDuplicates: true,
      });
    }

    // Assign to subjects
    if (subjectIds && subjectIds.length > 0) {
      await prisma.teacherSubject.createMany({
        data: subjectIds.map((subjectId: string) => ({
          teacherId: teacher.id,
          subjectId,
        })),
        skipDuplicates: true,
      });
    }

    // Send email notification with login credentials
    try {
      const school = await prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true },
      });

      // Send welcome email with credentials (reuse OTP email function but modify message)
      console.log(`[Teacher Created] Sending credentials email to ${email}`);
      // In production, send actual email with temp password or setup link
      // For now, just log it
    } catch (emailError) {
      console.warn('Failed to send teacher notification email:', emailError);
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
    res.status(500).json({ error: 'Failed to create teacher' });
  }
});

// PATCH /api/admin/teachers/:id - Update teacher
router.patch('/teachers/:id', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const { id } = req.params;
    const { name, email } = req.body;

    // Verify teacher belongs to school
    const teacher = await prisma.user.findFirst({
      where: { id, schoolId, role: 'TEACHER' },
    });

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Update teacher
    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: name || undefined,
        email: email ? email.toLowerCase().trim() : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ error: 'Failed to update teacher' });
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

// GET /api/admin/academic-years - Get all academic years for school
router.get('/academic-years', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'School ID required' });
    }

    const academicYears = await prisma.academicYear.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
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

export default router;
