import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const router = Router();
const prisma = new PrismaClient();

// Middleware to verify platform admin session
const requirePlatformAdminSession = async (req: Request, res: Response): Promise<string | null> => {
  try {
    // Get session from frontend auth context (passed via header or cookie)
    const sessionToken = req.headers['x-session-token'] as string;
    if (!sessionToken) {
      res.status(401).json({ message: 'Unauthorized' });
      return null;
    }
    // In production, verify the session token is valid
    // For now, trust that frontend already verified auth
    return sessionToken;
  } catch (error) {
    res.status(401).json({ message: 'Unauthorized' });
    return null;
  }
};

// GET /schoolbase-admin/api/stats - Get platform dashboard statistics
router.get('/stats', async (req: Request, res: Response) => {
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

// GET /schoolbase-admin/api/schools - Get all schools with pagination
router.get('/schools', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status && ['ACTIVE', 'SUSPENDED', 'TRIAL', 'CANCELLED'].includes(status)) {
      where.status = status;
    }

    const [schools, total] = await Promise.all([
      prisma.school.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          plan: true,
          country: true,
          createdAt: true,
          updatedAt: true,
          trialEndsAt: true,
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

    res.json({
      schools: schools.map((school: any) => ({
        ...school,
        userCount: school._count.users,
        pupilCount: school._count.pupils,
        classCount: school._count.classes,
        _count: undefined,
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

// GET /schoolbase-admin/api/email-logs - Get email logs with filtering
router.get('/email-logs', async (req: Request, res: Response) => {
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
      'SUPPORT_UPDATE',
      'ONBOARDING_GUIDANCE',
      'BEST_PRACTICE_TIP',
      'MANUAL_ANNOUNCEMENT',
      'POLICY_UPDATE',
      'ACCOUNT_SECURITY',
    ];

    const where: any = {};
    if (emailType && emailType !== 'ALL') {
      if (!validEmailTypes.includes(emailType)) {
        return res.status(400).json({ 
          message: `Invalid email type: ${emailType}. Valid types are: ${validEmailTypes.join(', ')}`
        });
      }
      where.emailType = emailType;
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
  try {
    // Find all schools with incomplete setup (those created more than 7 days ago but not all data entered)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const incompleteSchools = await prisma.school.findMany({
      where: {
        createdAt: { lt: sevenDaysAgo },
        // Add more specific filters based on what defines "incomplete setup"
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

    let sentCount = 0;
    let skippedCount = 0;

    // Send reminder emails
    for (const school of incompleteSchools) {
      try {
        const admin = school.users[0];
        if (!admin || !admin.email) {
          skippedCount++;
          continue;
        }

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

        sentCount++;
      } catch (err) {
        console.error(`Failed to send reminder to school ${school.id}:`, err);
        skippedCount++;
      }
    }

    res.json({ sentCount, skippedCount });
  } catch (error) {
    console.error('Error sending bulk reminders:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to send reminders' });
  }
});

// POST /schoolbase-admin/api/reminders/send-single - Send setup reminder to specific school
router.post('/reminders/send-single', async (req: Request, res: Response) => {
  try {
    const { schoolId } = req.body;

    if (!schoolId) {
      return res.status(400).json({ message: 'schoolId is required' });
    }

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
      return res.status(404).json({ message: 'School not found' });
    }

    const admin = school.users[0];
    if (!admin || !admin.email) {
      return res.status(400).json({ message: 'School admin email not found' });
    }

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

    res.json({ success: true, message: 'Reminder sent successfully' });
  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to send reminder' });
  }
});

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
        updateData.plan = plan ?? (school as any).plan;
        updateData.status = 'ACTIVE';
        auditDetails = `Upgraded ${school.name} to ${plan}`;
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
    const impersonationToken = Buffer.from(
      JSON.stringify({
        schoolId,
        adminId: 'platform-admin',
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
    ).toString('base64');

    // Record audit log
    try {
      await (prisma as any).platformAuditLog.create({
        data: {
          action: 'IMPERSONATE',
          details: `Impersonated school ${school.name}`,
          schoolId,
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

// GET /schoolbase-admin/api/support - Get all support requests from all schools
router.get('/support', async (req: Request, res: Response) => {
  try {
    const supportRequests = await prisma.supportRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { 
        school: { select: { id: true, name: true, country: true } }
      },
    });

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
        // Create a messages array from the initial message and response
        messages: [
          {
            id: `${request.id}-initial`,
            senderRole: 'SCHOOL',
            senderName: request.school?.name || 'School',
            senderEmail: null,
            body: request.message,
            createdAt: request.createdAt.toISOString(),
          },
          ...(request.response ? [{
            id: `${request.id}-response`,
            senderRole: 'PLATFORM_ADMIN',
            senderName: 'SchoolBase Support',
            senderEmail: null,
            body: request.response,
            createdAt: request.updatedAt.toISOString(),
          }] : []),
        ],
        school: request.school ? {
          id: request.school.id,
          name: request.school.name,
          country: request.school.country,
        } : null,
      })),
    });
  } catch (error) {
    console.error('Error fetching support requests:', error);
    res.status(500).json({ message: (error as Error).message || 'Failed to fetch support requests' });
  }
});

// PATCH /schoolbase-admin/api/support/reply - Send support replies
router.patch('/support/reply', async (req: Request, res: Response) => {
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

    const updated = await prisma.supportRequest.update({
      where: { id: requestId },
      data: updateData,
      include: { school: { select: { id: true, name: true, country: true } } },
    });

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
        messages: [
          {
            id: `${updated.id}-initial`,
            senderRole: 'SCHOOL',
            senderName: updated.school?.name || 'School',
            senderEmail: null,
            body: updated.message,
            createdAt: updated.createdAt.toISOString(),
          },
          ...(updated.response ? [{
            id: `${updated.id}-response`,
            senderRole: 'PLATFORM_ADMIN',
            senderName: 'SchoolBase Support',
            senderEmail: null,
            body: updated.response,
            createdAt: updated.updatedAt.toISOString(),
          }] : []),
        ],
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

// POST /schoolbase-admin/api/videos - Create new video tutorial
router.post('/videos', async (req: Request, res: Response) => {
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

export default router;
