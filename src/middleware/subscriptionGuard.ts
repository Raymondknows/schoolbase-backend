import { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ?? 'schoolbase-dev-secret-change-me'
  );
}

export interface SubscriptionCheckResult {
  isActive: boolean;
  reason?: string;
  school?: {
    id: string;
    name: string;
    status: string;
    plan: string;
    trialEndsAt: Date | null;
    subscriptionExpiresAt: Date | null;
  };
}

export async function checkSubscription(schoolId: string): Promise<SubscriptionCheckResult> {
  try {
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
      return { isActive: false, reason: 'School not found' };
    }

    if (school.status === 'ACTIVE') return { isActive: true, school };

    if (school.status === 'TRIAL') {
      if (school.trialEndsAt && new Date() < new Date(school.trialEndsAt)) {
        return { isActive: true, school };
      }
      return { isActive: false, reason: `Trial expired on ${school.trialEndsAt}`, school };
    }

    if (school.status === 'SUSPENDED') return { isActive: false, reason: 'Subscription suspended', school };
    if (school.status === 'CANCELLED') return { isActive: false, reason: 'Subscription cancelled', school };
    if (school.status === 'PENDING') return { isActive: false, reason: 'Subscription pending approval', school };

    return { isActive: false, reason: `Unknown status: ${school.status}`, school };
  } catch (error) {
    console.error('[subscriptionGuard] Error checking subscription:', error);
    return { isActive: false, reason: 'Failed to verify subscription' };
  }
}

function getSchoolIdFromRequest(req: Request) {
  const schoolId =
    (req.params?.schoolId as string) ||
    (req.query.schoolId as string) ||
    (req.headers['x-school-id'] as string) ||
    (req.body?.schoolId as string) ||
    (req as any).user?.schoolId;

  if (schoolId) return schoolId;

  const pathMatch = req.path?.match(/^\/school\/([^\/]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  return null;
}

export async function requireSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    // Allow platform admin or use schoolId from token when available
    const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
    let tokenSchoolId: string | null = null;
    let tokenRole: string | null = null;
    
    if (token) {
      try {
        const { payload } = await jwtVerify(token, secret());
        if (payload && typeof payload === 'object') {
          tokenRole = (payload as any).role;
          console.log(`[subscriptionGuard] Token role: ${tokenRole}, schoolId: ${(payload as any).schoolId || 'null'}`);
          
          if ((payload as any).role === 'PLATFORM_ADMIN') {
            console.log('[subscriptionGuard] Platform admin detected - bypassing guard');
            return next();
          }
          
          if ((payload as any).schoolId) tokenSchoolId = String((payload as any).schoolId);
        }
      } catch (err) {
        console.error('[subscriptionGuard] Token verification failed:', (err as Error).message);
        // ignore invalid token and fall through to other checks
      }
    } else {
      console.log('[subscriptionGuard] No session token found');
    }

    const schoolId = tokenSchoolId || getSchoolIdFromRequest(req);
    if (!schoolId) return res.status(400).json({ error: 'School ID required to verify subscription' });

    const check = await checkSubscription(schoolId);
    console.log(`[subscriptionGuard] schoolId: ${schoolId}, source: ${tokenSchoolId ? 'token' : 'request'}, active: ${check.isActive}, reason: ${check.reason || 'OK'}`);
    
    if (!check.isActive) {
      return res.status(403).json({
        error: 'Subscription required',
        reason: check.reason,
        code: 'SUBSCRIPTION_INACTIVE',
        school: check.school,
      });
    }

    (req as any).subscriptionCheck = check;
    next();
  } catch (error) {
    console.error('[subscriptionGuard] Middleware error:', error);
    res.status(500).json({ error: 'Failed to verify subscription' });
  }
}

export async function checkSubscriptionStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
    let tokenSchoolId: string | null = null;
    if (token) {
      try {
        const { payload } = await jwtVerify(token, secret());
        if (payload && typeof payload === 'object' && (payload as any).schoolId) {
          tokenSchoolId = String((payload as any).schoolId);
        }
      } catch {
        // ignore invalid token
      }
    }

    const schoolId = tokenSchoolId || getSchoolIdFromRequest(req);
    if (schoolId) {
      const check = await checkSubscription(schoolId);
      (req as any).subscriptionCheck = check;
      (req as any).subscriptionWarning = !check.isActive ? check.reason : null;
    }
    next();
  } catch (error) {
    console.error('[subscriptionGuard] Soft check error:', error);
    next();
  }
}

export default requireSubscription;
