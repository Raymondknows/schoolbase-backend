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

// GET /schoolbase-admin/api/support - Get all platform support requests
router.get('/support', async (req: Request, res: Response) => {
  try {
    const supportRequests = await (prisma as any).platformSupportRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { 
        messages: { orderBy: { createdAt: 'asc' } },
        school: { select: { id: true, name: true, country: true } }
      } as any,
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
        messages: (request.messages || []).map((message: any) => ({
          id: message.id,
          senderRole: message.senderRole,
          senderName: message.senderName,
          senderEmail: message.senderEmail,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
        })),
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
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { requestId, response: responseText, status } = req.body as {
      requestId: string;
      response: string;
      status?: string;
    };

    const supportRequest = await (prisma as any).platformSupportRequest.findUnique({
      where: { id: requestId },
      include: { messages: true },
    });

    if (!supportRequest) {
      return res.status(404).json({ message: 'Support request not found.' });
    }

    // Add reply message
    await (prisma as any).platformSupportMessage.create({
      data: {
        requestId,
        senderRole: 'PLATFORM_ADMIN',
        senderName: 'SchoolBase Support',
        body: responseText,
      },
    });

    // Update request status if provided
    const updateData: Record<string, unknown> = {};
    if (status) {
      updateData.status = status;
    }

    const updated = await (prisma as any).platformSupportRequest.update({
      where: { id: requestId },
      data: updateData,
      include: { messages: true },
    });

    res.json({ message: 'Reply sent.', supportRequest: updated });
  } catch (error) {
    console.error('Support reply error:', error);
    res.status(500).json({ message: (error as Error).message || 'Reply failed.' });
  }
});

// PATCH /schoolbase-admin/api/settings - Save platform settings
router.patch('/settings', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { settings } = req.body as { settings: Record<string, string> };

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ message: 'Invalid payload' });
    }

    // Upsert each setting
    await Promise.all(
      Object.entries(settings).map(([key, value]) =>
        (prisma as any).platformSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    );

    res.json({ message: 'Saved' });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ message: (error as Error).message || 'Save failed' });
  }
});

export default router;
