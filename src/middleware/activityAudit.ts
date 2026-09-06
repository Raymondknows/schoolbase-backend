import type { NextFunction, Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function getSessionSecret() {
  return new TextEncoder().encode(process.env.SESSION_SECRET || 'your-secret-key');
}

function getSessionToken(req: Request) {
  return req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session || null;
}

function getEventName(method: string, path: string) {
  const route = path.replace(/^\/+/, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_:-]/g, '');
  return `API_${method}_${route || 'ROOT'}`.slice(0, 190);
}

function getSafeBodyFields(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const excluded = new Set(['password', 'passwordHash', 'token', 'otp', 'secret', 'accessToken', 'refreshToken']);
  return Object.keys(body as Record<string, unknown>)
    .filter((key) => !excluded.has(key))
    .slice(0, 30)
    .join(', ');
}

export async function recordActivity(data: {
  event: string;
  details: string;
  userId?: string;
  schoolId?: string;
}) {
  await prisma.platformAuditLog.create({
    data: {
      event: data.event,
      details: data.details,
      userId: data.userId,
      schoolId: data.schoolId,
    },
  });
}

export function activityAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  const path = req.originalUrl || req.path;
  if (path.includes('/audit-logs') || path.includes('/health') || path.includes('/api/admin/verify')) {
    next();
    return;
  }

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;

    void (async () => {
      let userId: string | undefined;
      let schoolId: string | undefined;
      let role: string | undefined;

      try {
        const token = getSessionToken(req);
        if (token) {
          const { payload } = await jwtVerify(token, getSessionSecret());
          userId = typeof payload.userId === 'string' ? payload.userId : undefined;
          schoolId = typeof payload.schoolId === 'string' ? payload.schoolId : undefined;
          role = typeof payload.role === 'string' ? payload.role : undefined;
        }

        const fields = getSafeBodyFields(req.body);
        const details = [
          `${req.method} ${path}`,
          role ? `role: ${role}` : null,
          fields ? `fields: ${fields}` : null,
          `status: ${res.statusCode}`,
        ].filter(Boolean).join(' | ');

        await recordActivity({
          userId,
          schoolId,
          event: getEventName(req.method, req.path),
          details,
        });
      } catch (error) {
        console.warn('[AUDIT] Failed to record activity:', error instanceof Error ? error.message : error);
      }
    })();
  });

  next();
}
