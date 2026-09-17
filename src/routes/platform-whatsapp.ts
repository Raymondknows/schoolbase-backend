import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { jwtVerify } from 'jose';
import { platformBaileysSessionManager } from '../communications/platform-whatsapp-baileys.js';
import { platformWhatsAppService } from '../services/platform-whatsapp.js';

const prisma = new PrismaClient();

const router = Router();

function getAudienceFilters(audience?: string): any {
  const normalizedAudience = String(audience || 'All schools').trim();

  switch (normalizedAudience) {
    case 'Trial schools':
      return { status: 'TRIAL' as const };
    case 'Incomplete setups':
      return {
        OR: [
          { status: 'TRIAL' as const },
          { createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) } },
        ],
      };
    case 'Expiring schools':
      return {
        status: 'ACTIVE' as const,
        subscriptionExpiresAt: { not: null, lt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) },
      };
    case 'Renewal reminders':
      return {
        status: 'ACTIVE' as const,
        subscriptionExpiresAt: { not: null },
      };
    default:
      return {};
  }
}

function secret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET || 'your-secret-key');
}

async function requirePlatformAdminSession(req: Request, res: Response): Promise<string | null> {
  try {
    const cookieToken = req.cookies?.schoolbase_session;
    const headerToken = req.get('x-schoolbase-session') || req.get('X-Schoolbase-Session');
    const sessionToken = cookieToken || headerToken;

    if (!sessionToken) {
      res.status(401).json({ message: 'Unauthorized - no session' });
      return null;
    }

    const { payload } = await jwtVerify(sessionToken, secret());
    if (payload.role !== 'PLATFORM_ADMIN') {
      res.status(403).json({ message: 'Forbidden - not a platform admin' });
      return null;
    }

    return payload.userId as string;
  } catch (error) {
    console.error('[platform-whatsapp] Session verification error:', error);
    res.status(401).json({ message: 'Unauthorized - invalid session' });
    return null;
  }
}

router.get('/overview', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const overview = await platformWhatsAppService.getOverview();

    res.json({
      success: true,
      data: overview,
    });
  } catch (error) {
    console.error('[platform-whatsapp] overview error:', error);
    res.status(500).json({ message: 'Failed to load platform WhatsApp overview.' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const status = await platformWhatsAppService.getStatus();
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('[platform-whatsapp] status error:', error);
    res.status(500).json({ message: 'Failed to load platform WhatsApp status.' });
  }
});

router.post('/connect', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { phoneNumber, usePairingCode } = req.body ?? {};
    console.log('[platform-whatsapp] connect request', { phoneNumber, usePairingCode });

    const status = await platformBaileysSessionManager.connect(
      typeof phoneNumber === 'string' ? phoneNumber : undefined,
      Boolean(usePairingCode),
    );
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('[platform-whatsapp] connect error:', error);
    res.status(500).json({ message: 'Failed to connect platform WhatsApp.' });
  }
});

router.post('/disconnect', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const status = await platformBaileysSessionManager.disconnect();
    res.json({ success: true, session: status });
  } catch (error) {
    console.error('[platform-whatsapp] disconnect error:', error);
    res.status(500).json({ message: 'Failed to disconnect platform WhatsApp.' });
  }
});

router.post('/send-message', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { phoneNumber, phoneNumbers, message, schoolId, schoolIds } = req.body ?? {};
    let recipients: string[] = Array.isArray(phoneNumbers) ? phoneNumbers : phoneNumber ? [phoneNumber] : [];

    if ((!recipients.length && schoolId) || (!recipients.length && Array.isArray(schoolIds) && schoolIds.length)) {
      const schoolLookupIds = Array.isArray(schoolIds) ? schoolIds : schoolId ? [schoolId] : [];
      if (schoolLookupIds.length) {
        const schools = await prisma.school.findMany({
          where: { id: { in: schoolLookupIds } },
          select: { id: true, phone: true },
        });
        recipients = await platformWhatsAppService.resolveSchoolRecipients(schoolLookupIds, schools);
      }
    }

    if (!recipients.length || !message) {
      return res.status(400).json({ error: 'phoneNumber(s), schoolId(s), or a valid school contact and message are required' });
    }

    const results = await Promise.all(recipients.map(async (recipient: string) => {
      const result = await platformBaileysSessionManager.sendTextMessage(recipient, String(message));
      return { recipient, ...result };
    }));

    const failures = results.filter((result) => !result.success);
    if (failures.length) {
      return res.status(400).json({ success: false, error: failures[0].error || 'Failed to send platform WhatsApp message.', results });
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('[platform-whatsapp] send-message error:', error);
    res.status(500).json({ message: 'Failed to send platform WhatsApp message.' });
  }
});

router.get('/templates', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const items = await platformWhatsAppService.getTemplates();
    res.json({
      success: true,
      data: { items },
    });
  } catch (error) {
    console.error('[platform-whatsapp] templates error:', error);
    res.status(500).json({ message: 'Failed to load platform WhatsApp templates.' });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const template = await platformWhatsAppService.createTemplate(req.body ?? {});
    res.json({ success: true, template });
  } catch (error) {
    console.error('[platform-whatsapp] create-template error:', error);
    res.status(500).json({ message: 'Failed to create platform WhatsApp template.' });
  }
});

router.post('/campaigns/preview', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const payload = req.body ?? {};
    const audienceWhere = getAudienceFilters(payload.audience);
    const schoolCount = await prisma.school.count({ where: audienceWhere });
    const preview = await platformWhatsAppService.previewCampaign({
      ...payload,
      schoolCount,
    });
    res.json({ success: true, preview });
  } catch (error) {
    console.error('[platform-whatsapp] campaign-preview error:', error);
    res.status(500).json({ message: 'Failed to preview platform WhatsApp campaign.' });
  }
});

router.post('/campaigns', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const payload = req.body ?? {};
    const audienceWhere = getAudienceFilters(payload.audience);
    const schoolCount = await prisma.school.count({ where: audienceWhere });
    const campaign = await platformWhatsAppService.createCampaign({
      ...payload,
      schoolCount,
    });
    res.json({ success: true, campaign });
  } catch (error) {
    console.error('[platform-whatsapp] create-campaign error:', error);
    res.status(500).json({ message: 'Failed to create platform WhatsApp campaign.' });
  }
});

router.get('/campaigns', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const items = await platformWhatsAppService.getCampaigns();
    res.json({
      success: true,
      data: { items },
    });
  } catch (error) {
    console.error('[platform-whatsapp] campaigns error:', error);
    res.status(500).json({ message: 'Failed to load platform WhatsApp campaigns.' });
  }
});

router.get('/logs', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const items = await platformWhatsAppService.getLogs();
    res.json({
      success: true,
      data: { items },
    });
  } catch (error) {
    console.error('[platform-whatsapp] logs error:', error);
    res.status(500).json({ message: 'Failed to load platform WhatsApp logs.' });
  }
});

router.get('/readiness', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const readiness = await platformWhatsAppService.getReadiness();
    res.json({ success: true, readiness });
  } catch (error) {
    console.error('[platform-whatsapp] readiness error:', error);
    res.status(500).json({ message: 'Failed to load platform WhatsApp readiness.' });
  }
});

router.patch('/campaigns/:campaignId/status', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { campaignId } = req.params;
    const { status } = req.body ?? {};

    if (!campaignId || !status) {
      return res.status(400).json({ message: 'Campaign id and status are required.' });
    }

    const campaign = await platformWhatsAppService.updateCampaignStatus(campaignId, status);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    res.json({ success: true, campaign });
  } catch (error) {
    console.error('[platform-whatsapp] campaign-status error:', error);
    res.status(500).json({ message: 'Failed to update platform WhatsApp campaign status.' });
  }
});

router.post('/campaigns/:campaignId/send', async (req: Request, res: Response) => {
  const session = await requirePlatformAdminSession(req, res);
  if (!session) return;

  try {
    const { campaignId } = req.params;
    const campaign = await platformWhatsAppService.sendCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    res.json({ success: true, campaign });
  } catch (error) {
    console.error('[platform-whatsapp] campaign-send error:', error);
    res.status(500).json({ message: 'Failed to send platform WhatsApp campaign.' });
  }
});

export default router;
