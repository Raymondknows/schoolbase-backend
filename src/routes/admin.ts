import { Router, Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

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

  const token = req.cookies?.schoolbase_staff;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      if (payload && typeof payload === 'object' && 'schoolId' in payload) {
        return String((payload as any).schoolId);
      }
    } catch {
      // ignore invalid session token
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
    const token = req.cookies?.schoolbase_staff;
    
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

// GET /api/admin/school/:schoolId - Get school data
router.get('/school/:schoolId', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.params;
    
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
    console.error('Error fetching school:', error);
    res.status(500).json({ error: 'Failed to fetch school' });
  }
});

// GET /api/admin/settings - Get school settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string);

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
    const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string);

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
    res.json({
      database: 'connected',
      status: 'ok',
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
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const assetUrl = `/uploads/settings/${req.file.filename}`;
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
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    res.json({
      success: true,
      type: 'local',
      uploadUrl: '/api/admin/settings/upload',
      filename,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

// POST /api/admin/logo/confirm - Confirm logo upload
router.post('/logo/confirm', async (req: Request, res: Response) => {
  try {
    const { filename, url } = req.body;

    res.json({
      success: true,
      message: 'Logo confirmed',
      url,
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

    res.json({
      invoices,
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

    const [pupils, classes] = await Promise.all([
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
    ]);

    res.json({ pupils, classes });
  } catch (error) {
    console.error('Error fetching students data:', error);
    res.status(500).json({ error: 'Failed to fetch students data' });
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

export default router;
