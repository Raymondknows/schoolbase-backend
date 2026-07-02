import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { jwtVerify, SignJWT } from 'jose';
import axios from 'axios';
import { sendSetupReminderEmail } from '../services/email.js';
import { getPlatformSettings, serializePlatformSettingValue, parsePlatformSettingValue, platformSettingDefaults } from '../services/platform-settings.js';

const router = Router();
const prisma = new PrismaClient();

// Helper to get JWT secret
function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET || 'your-secret-key'
  );
}

// Middleware to verify platform admin session
const requirePlatformAdminSession = async (req: Request, res: Response): Promise<string | null> => {
  try {
    // Get session from httpOnly cookie
    const sessionToken = req.cookies?.schoolbase_session;
    if (!sessionToken) {
      res.status(401).json({ message: 'Unauthorized - no session' });
      return null;
    }

    // Verify JWT token
    const { payload } = await jwtVerify(sessionToken, secret());
    
    // Verify it's a platform admin
    if (payload.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ message: 'Forbidden - not a platform admin' });
      return null;
    }

    // Return userId for audit purposes
    return payload.userId as string;
  } catch (error) {
    console.error('[ADMIN] Session verification error:', error);
    res.status(401).json({ message: 'Unauthorized - invalid session' });
    return null;
  }
};

// GET /schoolbase-admin/api/subscription-payments - Get platform subscription payment history
router.get('/subscription-payments', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const page = parseInt(req.query.page as string) || 1;
    const skip = (page - 1) * limit;

    const payments = await prisma.platformPayment.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        method: true,
        reference: true,
        createdAt: true,
        recordedBy: true,
        note: true,
      },
    });

    const parseNote = (note: string | null) => {
      if (!note) return null;
      try {
        return JSON.parse(note);
      } catch {
        return null;
      }
    };

    const getSchoolNameFromNote = (noteText: string | null) => {
      if (!noteText) return null;
      const schoolNameMatch = noteText.match(/for\s+(.+?)\s*\(/i) || noteText.match(/for\s+(.+?)\s*—/i);
      if (schoolNameMatch?.[1]) {
        return schoolNameMatch[1].trim();
      }
      return null;
    };

    const paymentRecords = payments
      .map((payment: any) => {
        const parsedNote = parseNote(payment.note);
        const noteStatus = parsedNote?.paymentStatus?.toUpperCase() || parsedNote?.status?.toUpperCase();
        const noteText = typeof payment.note === 'string' ? payment.note : null;
        const reference = (payment.reference || '').toUpperCase();
        const isTrialLike =
          reference.startsWith('TRIAL-') ||
          /\btrial\b/i.test(noteText || '') ||
          payment.amount === 0 ||
          payment.method === 'OTHER';
        const hasSuccessfulStatus = noteStatus ? ['COMPLETED', 'SUCCESSFUL', 'SUCCESS', 'PAID', 'ACTIVE'].includes(noteStatus) : false;
        const isPaystackCheckoutEntry =
          parsedNote?.source === 'paystack-init' ||
          parsedNote?.source === 'paystack-verify' ||
          (payment.amount > 0 && payment.method === 'CARD' && Boolean(payment.reference));
        const isRelevantSubscriptionPayment = !isTrialLike && (hasSuccessfulStatus || isPaystackCheckoutEntry);

        return {
          payment,
          parsedNote,
          noteStatus,
          noteText,
          isRelevantSubscriptionPayment,
        };
      })
      .filter((entry) => entry.isRelevantSubscriptionPayment);

    const schoolIds = [...new Set(paymentRecords.flatMap((entry) => {
      const ids = [] as string[];
      if (entry.payment.recordedBy) ids.push(entry.payment.recordedBy);
      if (entry.parsedNote?.schoolId) ids.push(entry.parsedNote.schoolId);
      return ids;
    }).filter(Boolean))];

    const schools = schoolIds.length > 0
      ? await prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: {
            id: true,
            name: true,
            slug: true,
            email: true,
            country: true,
            plan: true,
            status: true,
          },
        })
      : [];

    const schoolMap = new Map(schools.map((school: any) => [school.id, school]));

    const formattedPayments = await Promise.all(paymentRecords.map(async (entry) => {
      const { payment, parsedNote, noteStatus, noteText } = entry;
      let school = schoolMap.get(payment.recordedBy) || (parsedNote?.schoolId ? schoolMap.get(parsedNote.schoolId) : null);

      if (!school) {
        const schoolName = getSchoolNameFromNote(noteText);
        if (schoolName) {
          const schoolMatch = await prisma.school.findFirst({
            where: {
              OR: [
                { name: { equals: schoolName } },
                { slug: { equals: schoolName } },
              ],
            },
            select: {
              id: true,
              name: true,
              slug: true,
              email: true,
              country: true,
              plan: true,
              status: true,
            },
          });
          school = schoolMatch || null;
        }
      }

      return {
        id: payment.id,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        createdAt: payment.createdAt,
        schoolId: payment.recordedBy || parsedNote?.schoolId || null,
        schoolName: school?.name || parsedNote?.schoolName || getSchoolNameFromNote(noteText) || 'Unknown school',
        schoolSlug: school?.slug || parsedNote?.schoolSlug || null,
        schoolEmail: school?.email || parsedNote?.schoolEmail || null,
        schoolCountry: school?.country || parsedNote?.schoolCountry || null,
        plan: school?.plan || parsedNote?.plan || null,
        status: school?.status || parsedNote?.status || null,
        paymentStatus: noteStatus || 'COMPLETED',
      };
    }));

    const total = formattedPayments.length;
    const startIndex = (page - 1) * limit;
    const paginatedPayments = formattedPayments.slice(startIndex, startIndex + limit);

    res.json({
      payments: formattedPayments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching subscription payments:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch subscription payments' });
  }
});

// GET /schoolbase-admin/api/stats - Get platform dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const [totalSchools, activeSchools, totalUsers, supportRequests, trialSchools] = await Promise.all([
      prisma.school.count(),
      prisma.school.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { role: { in: ['SCHOOL_ADMIN', 'BURSAR', 'TEACHER', 'PARENT'] } } }),
      (prisma as any).platformSupportRequest?.count?.() ?? Promise.resolve(0),
      prisma.school.count({ where: { status: 'TRIAL' } }),
    ]);

    res.json({
      totalSchools,
      activeSchools,
      totalUsers,
      supportRequests: supportRequests || 0,
      trialSchools,
      activePercentage: totalSchools > 0 ? Math.round((activeSchools / totalSchools) * 100) : 0,
    });
  } catch (error) {
    console.error('Error fetching platform stats:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch stats' });
  }
});

// GET /schoolbase-admin/api/profile - Get current platform admin profile
router.get('/profile', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    // Get the platform admin user (there should be one with role PLATFORM_ADMIN and no schoolId)
    const admin = await prisma.user.findFirst({
      where: {
        role: 'PLATFORM_ADMIN',
        schoolId: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    if (!admin) {
      return res.status(404).json({ message: 'Platform admin not found' });
    }

    res.json({ admin });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch profile' });
  }
});

// PATCH /schoolbase-admin/api/profile - Update current platform admin profile
router.patch('/profile', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }

    // Find the platform admin user
    const admin = await prisma.user.findFirst({
      where: {
        role: 'PLATFORM_ADMIN',
        schoolId: null,
      },
    });

    if (!admin) {
      return res.status(404).json({ message: 'Platform admin not found' });
    }

    // Update the admin profile
    const updated = await prisma.user.update({
      where: { id: admin.id },
      data: {
        name: name.trim(),
        email: email.trim(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    res.json({ admin: updated });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to update profile' });
  }
});

// GET /schoolbase-admin/api/settings - Get platform settings
router.get('/settings', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const settings = await getPlatformSettings(prisma);
    res.json({
      settings,
      defaults: platformSettingDefaults,
    });
  } catch (error) {
    console.error('Error fetching platform settings:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch settings' });
  }
});

// PATCH /schoolbase-admin/api/settings - Update platform settings
router.patch('/settings', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { settings } = req.body ?? {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ message: 'A settings object is required.' });
    }

    const entries = Object.entries(settings as Record<string, unknown>);
    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.platformSetting.upsert({
          where: { key },
          create: { key, value: serializePlatformSettingValue(value) },
          update: { value: serializePlatformSettingValue(value) },
        })
      )
    );

    await prisma.platformAuditLog.create({
      data: {
        userId: session,
        event: 'PLATFORM_SETTINGS_UPDATED',
        details: `Updated settings: ${entries.map(([key]) => key).join(', ')}`,
      },
    });

    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error updating platform settings:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to update settings' });
  }
});

// GET /schoolbase-admin/api/audit-logs - Get recent platform activity
router.get('/audit-logs', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const logs = await prisma.platformAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        event: true,
        details: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        school: {
          select: {
            name: true,
          },
        },
      },
    });

    res.json({ logs });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch activity' });
  }
});

// GET /schoolbase-admin/api/schools - Get all schools with pagination and optional filtering
router.get('/schools', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    const search = (req.query.search as string) || '';
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && ['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED'].includes(status)) {
      where.status = status;
    }

    if (search.trim()) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { country: { contains: search, mode: 'insensitive' } },
        { plan: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [schools, total] = await Promise.all([
      prisma.school.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          status: true,
          plan: true,
          country: true,
          createdAt: true,
          updatedAt: true,
          trialEndsAt: true,
          logoUrl: true,
          users: {
            where: { role: 'SCHOOL_ADMIN' },
            select: { email: true }
          },
          _count: {
            select: { users: true, pupils: true, classes: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.school.count({ where }),
    ]);

    // Get verification status for all schools - check if admin email has verified OTP
    const verificationMap = new Map<string, boolean>();
    if (schools.length > 0) {
      const adminEmails = schools
        .map((s: any) => s.users[0]?.email)
        .filter(Boolean);
      
      if (adminEmails.length > 0) {
        const verifiedOtps = await prisma.signupOtp.findMany({
          where: {
            email: { in: adminEmails },
            verifiedAt: { not: null }
          },
          select: { email: true }
        });
        
        verifiedOtps.forEach((otp: any) => {
          verificationMap.set(otp.email, true);
        });
      }
    }

    res.json({
      schools: schools.map((school: any) => ({
        id: school.id,
        name: school.name,
        slug: school.slug,
        email: school.email,
        phone: school.phone,
        status: school.status,
        plan: school.plan,
        country: school.country,
        createdAt: school.createdAt,
        updatedAt: school.updatedAt,
        trialEndsAt: school.trialEndsAt,
        logoUrl: school.logoUrl,
        userCount: school._count.users,
        pupilCount: school._count.pupils,
        classCount: school._count.classes,
        isVerified: verificationMap.has(school.users[0]?.email) || false,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching schools:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch schools' });
  }
});

// GET /schoolbase-admin/api/schools/:schoolId - Get single school detail
router.get('/schools/:schoolId', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { schoolId } = req.params;

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        country: true,
        email: true,
        phone: true,
        tagline: true,
        address: true,
        plan: true,
        status: true,
        trialEndsAt: true,
        createdAt: true,
        principalName: true,
        principalComment: true,
        stampUrl: true,
        principalSignatureUrl: true,
      },
    });

    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    res.json(school);
  } catch (error) {
    console.error('Error fetching school detail:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch school detail' });
  }
});

// GET /schoolbase-admin/api/email-logs - Get email logs with filtering
router.get('/email-logs', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const emailType = req.query.emailType as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const page = parseInt(req.query.page as string) || 1;
    const skip = (page - 1) * limit;

    // Valid email types from Prisma enum
    const validEmailTypes = [
      'SIGNUP_VERIFICATION',
      'PASSWORD_RESET',
      'TRIAL_STARTED',
      'PURCHASE_CONFIRMATION',
      'WELCOME',
      'GUARDIAN_REGISTRATION',
      'INVOICE_PAYMENT',
      'SETUP_COMPLETION_REMINDER',
      'GETTING_STARTED',
      'TRIAL_EXPIRY_WARNING',
      'SUBSCRIPTION_EXPIRY_WARNING',
      'ONBOARDING_CHECKLIST',
      'PRODUCT_UPDATE',
      'PRICE_UPDATE',
      'SUBSCRIPTION_THANK_YOU',
      'SUPPORT_UPDATE',
      'ONBOARDING_GUIDANCE',
      'BEST_PRACTICE_TIP',
      'MANUAL_ANNOUNCEMENT',
      'POLICY_UPDATE',
      'ACCOUNT_SECURITY',
    ];

    const where: any = {};
    if (emailType && emailType !== 'ALL') {
      const normalizedEmailType = emailType;
      if (!validEmailTypes.includes(normalizedEmailType)) {
        return res.status(400).json({ 
          message: `Invalid email type: ${emailType}. Valid types are: ${validEmailTypes.join(', ')}`
        });
      }
      where.emailType = normalizedEmailType;
    }

    const [logs, total] = await Promise.all([
      (prisma as any).emailLog.findMany({
        where,
        select: {
          id: true,
          schoolId: true,
          school: { select: { name: true } },
          recipientEmail: true,
          recipientName: true,
          emailType: true,
          subject: true,
          sentAt: true,
          status: true,
        },
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
      }),
      (prisma as any).emailLog.count({ where }),
    ]);

    res.json({
      logs: logs.map((log: any) => ({
        ...log,
        schoolName: log.school?.name,
        school: undefined,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching email logs:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch email logs' });
  }
});

// POST /schoolbase-admin/api/reminders/send-bulk - Send setup reminders to all incomplete schools
router.post('/reminders/send-bulk', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    console.log('📧 Sending bulk setup completion reminders...');
    
    // Find all schools with incomplete setup (those created more than 7 days ago but not all data entered)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const incompleteSchools = await prisma.school.findMany({
      where: {
        createdAt: { lt: sevenDaysAgo },
      },
      select: {
        id: true,
        name: true,
        email: true,
        users: {
          select: { email: true, name: true, role: true },
          where: { role: 'SCHOOL_ADMIN' },
        },
      },
    });

    console.log(`Found ${incompleteSchools.length} schools to send reminders to`);

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Send reminder emails
    for (const school of incompleteSchools) {
      try {
        const admin = school.users[0];
        if (!admin || !admin.email) {
          console.warn(`⚠️ No admin email for school ${school.id}`);
          failedCount++;
          continue;
        }

        // Send actual email
        await sendSetupReminderEmail(
          admin.email,
          admin.name || 'School Administrator',
          school.name
        );

        // Log the successful email send attempt
        await (prisma as any).emailLog.create({
          data: {
            schoolId: school.id,
            recipientEmail: admin.email,
            recipientName: admin.name,
            emailType: 'SETUP_COMPLETION_REMINDER',
            subject: `Complete your SchoolBase setup - ${school.name}`,
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        console.log(`✅ Reminder sent to ${school.name} (${admin.email})`);
        sentCount++;
      } catch (err: any) {
        console.error(`❌ Failed to send reminder to school ${school.id}:`, err);
        errors.push(`${school.name}: ${err.message}`);
        
        // Log the failed email attempt
        try {
          await (prisma as any).emailLog.create({
            data: {
              schoolId: school.id,
              recipientEmail: school.users[0]?.email,
              recipientName: school.users[0]?.name,
              emailType: 'SETUP_COMPLETION_REMINDER',
              subject: `Complete your SchoolBase setup - ${school.name}`,
              status: 'FAILED',
              error: err.message,
              sentAt: new Date(),
            },
          });
        } catch (logErr) {
          console.error('Failed to log email error:', logErr);
        }
        
        failedCount++;
      }
    }

    console.log(`📊 Summary: ${sentCount} sent, ${failedCount} failed`);
    
    res.json({ 
      success: true,
      sentCount, 
      failedCount,
      total: incompleteSchools.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('❌ Error sending bulk reminders:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Failed to send reminders' 
    });
  }
});

// POST /schoolbase-admin/api/reminders/send-single - Send setup reminder to specific school
router.post('/reminders/send-single', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { schoolId } = req.body;

    if (!schoolId) {
      return res.status(400).json({ 
        success: false,
        message: 'schoolId is required' 
      });
    }

    console.log(`📧 Sending setup reminder to school ${schoolId}...`);

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        email: true,
        users: {
          select: { email: true, name: true, role: true },
          where: { role: 'SCHOOL_ADMIN' },
        },
      },
    });

    if (!school) {
      return res.status(404).json({ 
        success: false,
        message: 'School not found' 
      });
    }

    const admin = school.users[0];
    if (!admin || !admin.email) {
      return res.status(400).json({ 
        success: false,
        message: 'School admin email not found' 
      });
    }

    try {
      // Send actual email
      await sendSetupReminderEmail(
        admin.email,
        admin.name || 'School Administrator',
        school.name
      );

      // Log the email send attempt
      await (prisma as any).emailLog.create({
        data: {
          schoolId: school.id,
          recipientEmail: admin.email,
          recipientName: admin.name,
          emailType: 'SETUP_COMPLETION_REMINDER',
          subject: `Complete your SchoolBase setup - ${school.name}`,
          status: 'SENT',
          sentAt: new Date(),
        },
      });

      console.log(`✅ Reminder sent to ${school.name} (${admin.email})`);
      
      res.json({ 
        success: true, 
        message: 'Reminder sent successfully',
        school: {
          id: school.id,
          name: school.name,
          adminEmail: admin.email
        }
      });
    } catch (emailError: any) {
      console.error(`❌ Failed to send email:`, emailError);
      
      // Log the failed attempt
      try {
        await (prisma as any).emailLog.create({
          data: {
            schoolId: school.id,
            recipientEmail: admin.email,
            recipientName: admin.name,
            emailType: 'SETUP_COMPLETION_REMINDER',
            subject: `Complete your SchoolBase setup - ${school.name}`,
            status: 'FAILED',
            error: emailError.message,
            sentAt: new Date(),
          },
        });
      } catch (logErr) {
        console.error('Failed to log email error:', logErr);
      }
      
      throw emailError;
    }
  } catch (error: any) {
    console.error('❌ Error sending reminder:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Failed to send reminder' 
    });
  }
});

// Helper function to get the next plan tier
function getNextPlan(currentPlan: string): string {
  const planProgression: Record<string, string> = {
    'FREE': 'STARTER',
    'STARTER': 'GROWTH',
    'GROWTH': 'ENTERPRISE',
    'ENTERPRISE': 'ENTERPRISE' // Can't upgrade beyond ENTERPRISE
  };
  return planProgression[currentPlan] || currentPlan;
}

// PATCH /schoolbase-admin/api/schools - School management actions
router.patch('/schools', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { schoolId, action, plan, days } = req.body as {
      schoolId: string;
      action: string;
      plan?: string;
      days?: number;
    };

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    let updateData: Record<string, unknown> = {};
    let auditDetails = '';

    switch (action) {
      case 'suspend':
        updateData.status = 'SUSPENDED';
        auditDetails = `Suspended school ${school.name}`;
        break;
      case 'activate':
        updateData.status = 'ACTIVE';
        auditDetails = `Activated school ${school.name}`;
        break;
      case 'upgrade':
        const currentPlan = (school as any).plan;
        const nextPlan = getNextPlan(currentPlan);
        updateData.plan = nextPlan;
        updateData.status = 'ACTIVE';
        auditDetails = `Upgraded ${school.name} from ${currentPlan} to ${nextPlan}`;
        break;
      case 'setPlan':
        const validPlans = ['FREE', 'STARTER', 'GROWTH', 'ENTERPRISE'];
        if (!plan || !validPlans.includes(plan)) {
          return res.status(400).json({ message: 'A valid plan is required.' });
        }
        updateData.plan = plan;
        if (school.status === 'PENDING') {
          updateData.status = 'ACTIVE';
          auditDetails = `Approved subscription and set plan for ${school.name} to ${plan}`;
        } else {
          auditDetails = `Set plan for ${school.name} to ${plan}`;
        }
        break;
      case 'extendTrial':
        if (!days) {
          return res.status(400).json({ message: 'Days are required to extend trial.' });
        }
        updateData.trialEndsAt = (school as any).trialEndsAt
          ? new Date(((school as any).trialEndsAt as Date).getTime() + days * 24 * 60 * 60 * 1000)
          : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        auditDetails = `Extended trial for ${school.name} by ${days} days`;
        break;
      case 'cancel':
        updateData.status = 'CANCELLED';
        auditDetails = `Cancelled subscription for ${school.name}`;
        break;
      default:
        return res.status(400).json({ message: 'Invalid action.' });
    }

    const updated = await prisma.school.update({
      where: { id: schoolId },
      data: updateData,
    });

    // Record audit log
    try {
      await (prisma as any).platformAuditLog.create({
        data: {
          action: action.toUpperCase(),
          details: auditDetails,
          schoolId,
        },
      });
    } catch (err) {
      // Ignore audit log errors
    }

    res.json({ message: 'Action completed.', school: updated });
  } catch (error) {
    console.error('School action error:', error);
    res.status(500).json({ message: (error as Error).message || 'Action failed.' });
  }
});

// POST /schoolbase-admin/api/impersonate - Impersonate a school
router.post('/impersonate', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { schoolId } = req.body as { schoolId: string };

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      return res.status(404).json({ message: 'School not found.' });
    }

    // Create impersonation token (valid for 1 hour)
    const impersonationToken = await new SignJWT({
      schoolId,
      adminId: session,
      purpose: 'IMPERSONATION',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret());

    // Record audit log
    try {
      await (prisma as any).platformAuditLog.create({
        data: {
          action: 'IMPERSONATE',
          details: `Impersonated school ${school.name}`,
          schoolId,
          userId: session,
        },
      });
    } catch (err) {
      // Ignore audit log errors
    }

    res.json({
      message: 'Impersonation token created.',
      token: impersonationToken,
      redirectUrl: `/admin?impersonate=${impersonationToken}`,
    });
  } catch (error) {
    console.error('Impersonate error:', error);
    res.status(500).json({ message: (error as Error).message || 'Impersonation failed.' });
  }
});

// POST /schoolbase-admin/api/impersonate/exchange - Exchange impersonation token for a school session token
router.post('/impersonate/exchange', async (req: Request, res: Response) => {
  try {
    const { token } = req.body as { token: string };
    if (!token) {
      return res.status(400).json({ message: 'Impersonation token is required.' });
    }

    const { payload } = await jwtVerify(token, secret());
    const schoolId = (payload as any).schoolId;
    const purpose = (payload as any).purpose;
    const adminId = (payload as any).adminId ?? 'platform-admin';

    if (!schoolId || purpose !== 'IMPERSONATION') {
      return res.status(400).json({ message: 'Invalid impersonation token.' });
    }

    const sessionToken = await new SignJWT({
      userId: adminId,
      role: 'SCHOOL_ADMIN',
      email: `impersonation@schoolbase.local`,
      name: 'Platform Admin Impersonator',
      schoolId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());

    res.json({
      message: 'Impersonation session created.',
      token: sessionToken,
      schoolId,
    });
  } catch (error) {
    console.error('Impersonation exchange error:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to exchange impersonation token.' });
  }
});

// GET /schoolbase-admin/api/support - Get all support requests from all schools
router.get('/support', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const supportRequests = await prisma.supportRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        school: { select: { id: true, name: true, country: true } }
      },
    });

    res.json({ 
      supportRequests: (supportRequests as any[]).map((request) => {
        const messages = ((request as any).messages || []).map((message: any) => {
          const isSchoolMessage = message.senderRole === 'SCHOOL';
          const normalizedSenderName = typeof message.senderName === 'string' ? message.senderName.trim() : '';
          const senderName = isSchoolMessage
            ? (request.school?.name || normalizedSenderName || 'School')
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
          school: request.school ? {
            id: request.school.id,
            name: request.school.name,
            country: request.school.country,
          } : null,
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching support requests:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch support requests' });
  }
});

// PATCH /schoolbase-admin/api/support/reply - Send support replies
router.patch('/support/reply', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { requestId, response: responseText, status } = req.body as {
      requestId: string;
      response: string;
      status?: string;
    };

    const supportRequest = await prisma.supportRequest.findUnique({
      where: { id: requestId },
      include: { school: { select: { id: true, name: true, country: true } } },
    });

    if (!supportRequest) {
      return res.status(404).json({ message: 'Support request not found.' });
    }

    // Update request with response
    const updateData: Record<string, unknown> = {
      response: responseText,
    };
    if (status) {
      updateData.status = status;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.supportRequest.update({
        where: { id: requestId },
        data: updateData,
      });

      if (responseText) {
        await tx.supportRequestMessage.create({
          data: {
            supportRequestId: requestId,
            senderRole: 'PLATFORM_ADMIN',
            senderName: 'SchoolBase Support',
            senderEmail: null,
            body: responseText,
          },
        });
      }

      return tx.supportRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          school: { select: { id: true, name: true, country: true } },
        },
      });
    });

    const messages = ((updated as any).messages || []).map((message: any) => {
      const isSchoolMessage = message.senderRole === 'SCHOOL';
      const normalizedSenderName = typeof message.senderName === 'string' ? message.senderName.trim() : '';
      const senderName = isSchoolMessage
        ? (updated.school?.name || normalizedSenderName || 'School')
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

    if (updated.response && !messages.some((message: any) => message.body === updated.response)) {
      messages.push({
        id: `${updated.id}-response`,
        senderRole: 'PLATFORM_ADMIN',
        senderName: 'SchoolBase Support',
        senderEmail: null,
        body: updated.response,
        createdAt: updated.updatedAt.toISOString(),
      });
    }

    // Return in the same format as the GET endpoint
    res.json({ 
      message: 'Reply sent.',
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
        school: updated.school,
      }
    });
  } catch (error) {
    console.error('Support reply error:', error);
    res.status(500).json({ message: (error as Error).message || 'Reply failed.' });
  }
});

// GET /schoolbase-admin/api/videos - Get all video tutorials
router.get('/videos', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const videos = await prisma.videoTutorial.findMany({
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      videos: videos.map((video: any) => ({
        id: video.id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        category: video.category,
        featured: video.featured,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch videos' });
  }
});

// GET /schoolbase-admin/api/videos/:videoId - Get a specific video tutorial
router.get('/videos/:videoId', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { videoId } = req.params;

    const video = await prisma.videoTutorial.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json({ video });
  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ message: 'Failed to fetch video' });
  }
});

// POST /schoolbase-admin/api/videos - Create new video tutorial
router.post('/videos', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { title, description, videoUrl, category, featured } = req.body;

    if (!title || !videoUrl) {
      return res.status(400).json({ message: 'Title and Video URL are required' });
    }

    const video = await prisma.videoTutorial.create({
      data: {
        title,
        description: description || '',
        videoUrl,
        category: category || 'Getting Started',
        featured: featured || false,
      },
    });

    res.status(201).json({
      videoId: video.id,
      ...video,
    });
  } catch (error) {
    console.error('Error creating video:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to create video' });
  }
});

// PATCH /schoolbase-admin/api/videos/:videoId - Update video tutorial
router.patch('/videos/:videoId', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { videoId } = req.params;
    const { title, description, videoUrl, category, featured } = req.body;

    if (!videoId) {
      return res.status(400).json({ message: 'Video ID is required' });
    }

    const video = await prisma.videoTutorial.update({
      where: { id: videoId },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(videoUrl && { videoUrl }),
        ...(category && { category }),
        ...(featured !== undefined && { featured }),
      },
    });

    res.json(video);
  } catch (error) {
    console.error('Error updating video:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to update video' });
  }
});

// DELETE /schoolbase-admin/api/videos/:videoId - Delete video tutorial
router.delete('/videos/:videoId', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({ message: 'Video ID is required' });
    }

    await prisma.videoTutorial.delete({
      where: { id: videoId },
    });

    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to delete video' });
  }
});

// POST /schoolbase-admin/api/emails/send - Send platform communication emails
router.post('/emails/send', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { targetType, selectedSchoolId, selectedSegment, emailType, subject, body } = req.body as {
      targetType: 'school' | 'segment';
      selectedSchoolId?: string;
      selectedSegment?: string;
      emailType: string;
      subject: string;
      body: string;
    };

    // Validate required fields
    if (!emailType || !subject || !body) {
      return res.status(400).json({ message: 'Email type, subject, and body are required.' });
    }

    let schools: any[] = [];

    // Get schools based on target type
    if (targetType === 'school') {
      if (!selectedSchoolId) {
        return res.status(400).json({ message: 'School ID is required for single school target.' });
      }
      schools = await prisma.school.findMany({
        where: { id: selectedSchoolId },
        include: {
          users: {
            where: { role: 'SCHOOL_ADMIN' },
            select: { email: true, name: true },
          },
        },
      });
    } else if (targetType === 'segment') {
      const where: any = {};
      
      if (selectedSegment === 'active') {
        where.status = 'ACTIVE';
      } else if (selectedSegment === 'trial') {
        where.status = 'TRIAL';
      } else if (selectedSegment === 'new') {
        // New schools in the last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        where.createdAt = { gte: sevenDaysAgo };
      }
      // 'all' segment has no where clause

      schools = await prisma.school.findMany({
        where,
        include: {
          users: {
            where: { role: 'SCHOOL_ADMIN' },
            select: { email: true, name: true },
          },
        },
      });
    }

    if (schools.length === 0) {
      return res.status(400).json({ message: 'No schools found matching the selection criteria.' });
    }

    // Send emails
    const { sendPlatformCommunicationEmail } = await import('../services/email.js');
    
    let sentCount = 0;
    let skippedCount = 0;

    for (const school of schools) {
      const adminUser = school.users[0];
      if (!adminUser?.email) {
        skippedCount++;
        continue;
      }

      try {
        await sendPlatformCommunicationEmail(
          adminUser.email,
          adminUser.name || 'School Admin',
          school.name,
          emailType,
          subject,
          body
        );

        // Log email sent
        await (prisma as any).emailLog.create({
          data: {
            schoolId: school.id,
            recipientEmail: adminUser.email,
            recipientName: adminUser.name,
            emailType,
            subject,
            sentAt: new Date(),
            status: 'SENT',
          },
        }).catch(() => {}); // Ignore logging errors

        sentCount++;
      } catch (err) {
        skippedCount++;
        console.error(`Failed to send email to ${adminUser.email}:`, err);
        
        // Log failed email
        await (prisma as any).emailLog.create({
          data: {
            schoolId: school.id,
            recipientEmail: adminUser.email,
            recipientName: adminUser.name,
            emailType,
            subject,
            sentAt: new Date(),
            status: 'FAILED',
            error: (err as Error).message,
          },
        }).catch(() => {}); // Ignore logging errors
      }
    }

    res.json({
      success: true,
      sentCount,
      skippedCount,
      total: schools.length,
    });
  } catch (error: any) {
    console.error('❌ Error sending platform emails:', error);
    res.status(500).json({ 
      message: error.message || 'Failed to send emails'
    });
  }
});

export default router;
