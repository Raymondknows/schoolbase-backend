import { Router, Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { verifyAuth } from '../middleware/roleAuth.js';
import { getSessionSecret } from '../services/security-config.js';
import { resolveSchoolScope } from '../services/security-context.js';

const router = Router();

function secret() {
  return getSessionSecret();
}

async function resolveSchoolId(req: Request): Promise<string | null> {
  const requestedSchoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string) || (req.body as any)?.schoolId;

  const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
  let authenticatedSchoolId: string | null = null;
  let authenticatedRole: string | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      if (payload && typeof payload === 'object') {
        authenticatedRole = typeof payload.role === 'string' ? payload.role : null;
        if ('schoolId' in payload && payload.schoolId) {
          authenticatedSchoolId = String((payload as any).schoolId);
        }
      }
    } catch (error) {
      console.error('[whatsapp-retry] Failed to resolve schoolId from token', error);
    }
  }

  const scope = resolveSchoolScope({ authenticatedSchoolId, authenticatedRole, requestedSchoolId });
  if (scope.rejected) {
    console.warn('[whatsapp-retry] Rejected cross-school scope request');
    return null;
  }

  return scope.schoolId;
}

// POST /api/whatsapp/retry - Retry failed WhatsApp message
router.post('/retry', verifyAuth, async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(403).json({ error: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope verification failed' });
    }

    const { messageId, phoneNumber, message } = req.body;

    if (!messageId || !phoneNumber || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    res.json({
      success: true,
      message: 'Message retry initiated',
      messageId,
      status: 'pending',
      schoolId,
    });
  } catch (error: any) {
    console.error('Error retrying WhatsApp message:', error);
    res.status(500).json({
      error: 'Failed to retry message',
      details: error.message,
    });
  }
});

export default router;
