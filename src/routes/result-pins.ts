import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import crypto from 'crypto';
import { CommunicationService, RulesEngine, TemplateEngine, RecipientResolver, DeliveryQueue, DriverManager, EmailDriver, WhatsAppDriver } from '../communications/index.js';
import baileysSessionManager from '../communications/whatsapp-baileys.js';
import { CommunicationRulesRegistry, DEFAULT_COMMUNICATION_RULES } from '../communications/rules.js';
import { buildPinDeliveryEmailContent, buildPinDeliveryWhatsAppMessage, sendPinDeliveryEmail } from '../services/email.js';
import { resolveGuardianNotificationTargets } from '../services/guardian-notification-recipients.js';
import { buildBulkPinNotificationBatches, validateBulkPinNotificationRequest } from '../services/pin-notification-batch-guards.js';
import { resolvePublicResultsUrl } from '../services/public-url.js';

const router = Router();
const prisma = new PrismaClient();
const communicationRulesRegistry = new CommunicationRulesRegistry(DEFAULT_COMMUNICATION_RULES);

const sharedDriverManager = new DriverManager({
  EMAIL: new EmailDriver(async ({ recipient, request }) => {
    const metadata = { ...(request.metadata ?? {}), ...(request.data ?? {}) } as Record<string, unknown>;
    const schoolName = String(metadata.schoolName ?? 'School');
    const logoUrl = typeof metadata.logoUrl === 'string' ? metadata.logoUrl : undefined;

    await sendPinDeliveryEmail(
      recipient.address,
      recipient.name ?? 'Guardian',
      String(metadata.pupilName ?? 'Student'),
      String(metadata.pin ?? ''),
      schoolName,
      logoUrl,
      typeof metadata.resultsUrl === 'string' ? metadata.resultsUrl : undefined,
      typeof metadata.schoolCode === 'string' ? metadata.schoolCode : undefined,
      typeof metadata.admissionNumber === 'string' ? metadata.admissionNumber : undefined,
      typeof metadata.sessionName === 'string' ? metadata.sessionName : undefined,
      typeof metadata.termName === 'string' ? metadata.termName : undefined,
    );

    return { channel: 'EMAIL', recipient: recipient.address, status: 'SENT', provider: 'email-service' } as const;
  }),
  WHATSAPP: new WhatsAppDriver(async ({ recipient, request }) => {
    const schoolId = request.schoolId ?? '';
    const metadata = { ...(request.metadata ?? {}), ...(request.data ?? {}) } as Record<string, unknown>;
    const message = buildPinDeliveryWhatsAppMessage({
      guardianName: String(recipient.name ?? 'Guardian'),
      pupilName: String(metadata.pupilName ?? 'Student'),
      pin: String(metadata.pin ?? ''),
      schoolName: String(metadata.schoolName ?? 'SchoolBase'),
      schoolCode: typeof metadata.schoolCode === 'string' ? metadata.schoolCode : undefined,
      admissionNumber: typeof metadata.admissionNumber === 'string' ? metadata.admissionNumber : undefined,
      sessionName: typeof metadata.sessionName === 'string' ? metadata.sessionName : undefined,
      termName: typeof metadata.termName === 'string' ? metadata.termName : undefined,
      resultsUrl: typeof metadata.resultsUrl === 'string' ? resolvePublicResultsUrl(metadata.resultsUrl) : 'https://schoolbase.live/results/check',
    });

    const result = await baileysSessionManager.sendTextMessage(schoolId, recipient.address, message) as { success: boolean; messageId?: string; error?: string };

    if (!result.success) {
      return { channel: 'WHATSAPP', recipient: recipient.address, status: 'FAILED', provider: 'baileys', error: result.error } as const;
    }

    return { channel: 'WHATSAPP', recipient: recipient.address, status: 'SENT', provider: 'baileys', messageId: result.messageId } as const;
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

function truncateNotificationBody(body: string, maxLength = 180) {
  if (!body) return body;
  if (body.length <= maxLength) return body;
  return `${body.slice(0, maxLength - 1)}…`;
}

function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ?? 'schoolbase-dev-secret-change-me',
  );
}

function normalizePin(value: unknown): string {
  return String(value ?? '').trim();
}

function generateNumericPin(length = 6): string {
  const max = Number.parseInt('9'.repeat(length), 10);
  return String(crypto.randomInt(0, max + 1)).padStart(length, '0');
}

function generatePinValue(length = 8, format = 'XXXX-XXXX'): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const normalizedLength = Number.isInteger(length) && length > 0 ? length : 8;
  const safeLength = Math.max(4, Math.min(normalizedLength, 12));
  let value = '';

  for (let index = 0; index < safeLength; index += 1) {
    const randomIndex = crypto.randomInt(0, charset.length);
    value += charset[randomIndex];
  }

  if (format === 'XXXX-XXXX-XXXX') {
    return value.match(/.{1,4}/g)?.join('-') ?? value;
  }

  if (format === 'XXXX-XXXX') {
    return value.match(/.{1,4}/g)?.join('-') ?? value;
  }

  return value;
}

async function resolveSchoolId(req: Request): Promise<string | null> {
  const schoolId = (req.query.schoolId as string) || (req.headers['x-school-id'] as string) || (req.body as any)?.schoolId;
  if (schoolId) return schoolId;

  const token = req.cookies?.schoolbase_session || req.cookies?.schoolbase_staff || req.cookies?.staff_session;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload && typeof payload === 'object' && 'schoolId' in payload) {
      return String((payload as any).schoolId);
    }
  } catch (error) {
    console.error('[result-pins] Failed to resolve schoolId from token', error);
  }

  return null;
}

async function ensureResultPinFeatureEnabled(schoolId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      resultAccessPinEnabled: true,
      resultAccessMode: true,
      resultAccessPinType: true,
      resultAccessPinValidity: true,
      resultAccessAllowRegeneration: true,
    },
  });

  if (!school) {
    return { school: null, isEnabled: false };
  }

  return {
    school,
    isEnabled: Boolean(school.resultAccessPinEnabled),
  };
}

async function resolvePinMetadata(termId: string | null, assessmentId: string | null) {
  const metadata: { sessionName?: string | null; termName?: string | null; assessmentName?: string | null } = {};

  if (termId) {
    const term = await prisma.term.findUnique({
      where: { id: termId },
      select: {
        name: true,
        academicYear: {
          select: { name: true },
        },
      },
    });

    metadata.termName = term?.name || null;
    metadata.sessionName = term?.academicYear?.name || null;
  }

  if (assessmentId) {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        name: true,
        term: {
          select: {
            name: true,
            academicYear: {
              select: { name: true },
            },
          },
        },
      },
    });

    metadata.assessmentName = assessment?.name || null;
    metadata.termName = metadata.termName || assessment?.term?.name || null;
    metadata.sessionName = metadata.sessionName || assessment?.term?.academicYear?.name || null;
  }

  return metadata;
}

router.post('/generate/student', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const { pupilId, termId, assessmentId, expiresAt, generatedBy, pinFormat, pinLength } = req.body as any;
    if (!pupilId) {
      return res.status(400).json({ error: 'pupilId is required' });
    }

    const { school, isEnabled } = await ensureResultPinFeatureEnabled(schoolId);
    if (!school || !isEnabled) {
      return res.status(403).json({ error: 'Result PIN access is disabled for this school' });
    }

    const pupil = await prisma.pupil.findFirst({
      where: { id: pupilId, schoolId },
      select: { id: true, firstName: true, lastName: true },
    });

    if (!pupil) {
      return res.status(404).json({ error: 'Student not found for this school' });
    }

    const pin = generatePinValue(Number(pinLength) || 8, pinFormat || 'XXXX-XXXX');
    const pinHash = await bcrypt.hash(pin, 10);

    const createdPin = await prisma.resultPin.create({
      data: {
        schoolId,
        studentId: pupil.id,
        termId: termId || null,
        assessmentId: assessmentId || null,
        pinHash,
        pinValue: pin,
        type: 'STUDENT',
        status: 'ACTIVE',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        generatedBy: generatedBy || 'system',
        generatedAt: new Date(),
      },
      select: {
        id: true,
        studentId: true,
        termId: true,
        assessmentId: true,
        type: true,
        status: true,
        expiresAt: true,
        generatedAt: true,
      },
    });

    const metadata = await resolvePinMetadata(createdPin.termId || null, createdPin.assessmentId || null);

    res.json({
      ok: true,
      pin,
      pinRecord: createdPin,
      student: pupil,
      sessionName: metadata.sessionName || null,
      termName: metadata.termName || null,
      assessmentName: metadata.assessmentName || null,
    });
  } catch (error) {
    console.error('[result-pins] Failed to generate student PIN', error);
    res.status(500).json({ error: 'Failed to generate student PIN' });
  }
});

router.post('/generate/batch', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const { quantity = 10, batchName, termId, assessmentId, expiresAt, generatedBy, pinFormat, pinLength } = req.body as any;
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 250) {
      return res.status(400).json({ error: 'quantity must be a whole number between 1 and 250' });
    }

    const { school, isEnabled } = await ensureResultPinFeatureEnabled(schoolId);
    if (!school || !isEnabled) {
      return res.status(403).json({ error: 'Result PIN access is disabled for this school' });
    }

    const batch = await prisma.resultPinBatch.create({
      data: {
        schoolId,
        batchName: batchName || `Batch ${new Date().toISOString().slice(0, 10)}`,
        type: 'GENERIC',
        quantity,
        generatedBy: generatedBy || 'system',
        generatedAt: new Date(),
      },
    });

    const generatedPins = [] as Array<{ pin: string; recordId: string }>;
    for (let index = 0; index < quantity; index += 1) {
      const pin = generatePinValue(Number(pinLength) || 8, pinFormat || 'XXXX-XXXX');
      const pinHash = await bcrypt.hash(pin, 10);
      const createdRecord = await prisma.resultPin.create({
        data: {
          schoolId,
          batchId: batch.id,
          termId: termId || null,
          assessmentId: assessmentId || null,
          pinHash,
          pinValue: pin,
          type: 'GENERIC',
          status: 'ACTIVE',
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          generatedBy: generatedBy || 'system',
          generatedAt: new Date(),
        },
        select: { id: true },
      });
      generatedPins.push({ pin, recordId: createdRecord.id });
    }

    res.json({
      ok: true,
      batch,
      pins: generatedPins,
    });
  } catch (error) {
    console.error('[result-pins] Failed to generate PIN batch', error);
    res.status(500).json({ error: 'Failed to generate PIN batch' });
  }
});

router.post('/generate/class', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const { classId, termId, assessmentId, expiresAt, generatedBy, pinFormat, pinLength } = req.body as any;
    if (!classId) {
      return res.status(400).json({ error: 'classId is required' });
    }

    const { school, isEnabled } = await ensureResultPinFeatureEnabled(schoolId);
    if (!school || !isEnabled) {
      return res.status(403).json({ error: 'Result PIN access is disabled for this school' });
    }

    const pupils = await prisma.pupil.findMany({
      where: { schoolId, classId: String(classId), isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const cards: Array<{
      student: { id: string; firstName: string; lastName: string; admissionNo?: string | null };
      pin: string;
      termId?: string | null;
      assessmentId?: string | null;
    }> = [];

    for (const pupil of pupils) {
      const pin = generatePinValue(Number(pinLength) || 8, pinFormat || 'XXXX-XXXX');
      const pinHash = await bcrypt.hash(pin, 10);
      await prisma.resultPin.create({
        data: {
          schoolId,
          studentId: pupil.id,
          termId: termId || null,
          assessmentId: assessmentId || null,
          pinHash,
          pinValue: pin,
          type: 'STUDENT',
          status: 'ACTIVE',
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          generatedBy: generatedBy || 'system',
          generatedAt: new Date(),
        },
      });
      cards.push({
        student: pupil,
        pin,
        termId: termId || null,
        assessmentId: assessmentId || null,
      });
    }

    const metadata = await resolvePinMetadata(termId || null, assessmentId || null);

    res.json({
      ok: true,
      school: {
        id: school.id,
      },
      sessionName: metadata.sessionName || null,
      termName: metadata.termName || null,
      assessmentName: metadata.assessmentName || null,
      cards,
    });
  } catch (error) {
    console.error('[result-pins] Failed to generate class PINs', error);
    res.status(500).json({ error: 'Failed to generate class PINs' });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const { school, isEnabled } = await ensureResultPinFeatureEnabled(schoolId);
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({
      ok: true,
      enabled: isEnabled,
      mode: school.resultAccessMode || 'NONE',
      pinType: school.resultAccessPinType || 'NONE',
      pinValidity: school.resultAccessPinValidity || 'TERM',
      allowRegeneration: Boolean(school.resultAccessAllowRegeneration),
    });
  } catch (error) {
    console.error('[result-pins] Failed to fetch PIN status', error);
    res.status(500).json({ error: 'Failed to fetch PIN status' });
  }
});

router.get('/pins', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 250);
    const page = Math.max(1, Number(req.query.page || 1));
    const skip = (page - 1) * limit;

    const where: any = {
      schoolId,
    };

    if (search) {
      where.OR = [
        { id: { contains: search } },
        { type: { contains: search } },
        { status: { contains: search } },
      ];
    }
    // Optional type filter (e.g., GENERIC, STUDENT)
    if (req.query.type) {
      const typeFilter = String(req.query.type).toUpperCase();
      where.type = typeFilter;
    }

    if (req.query.status && String(req.query.status).toLowerCase() !== 'all') {
      where.status = String(req.query.status).toUpperCase();
    }

    if (req.query.batch && String(req.query.batch).trim()) {
      const batchName = String(req.query.batch).trim();
      where.batch = { batchName };
    }

    if (req.query.term && String(req.query.term).trim()) {
      const termName = String(req.query.term).trim();
      where.term = { name: termName };
    }

    if (req.query.session && String(req.query.session).trim()) {
      const sessionName = String(req.query.session).trim();
      where.term = { ...(where.term || {}), academicYear: { name: sessionName } };
    }

    if (req.query.generatedBy && String(req.query.generatedBy).trim() && String(req.query.generatedBy) !== 'all') {
      where.generatedBy = String(req.query.generatedBy).trim();
    }

    if (req.query.classId && String(req.query.classId).trim() && String(req.query.classId) !== 'all') {
      const classId = String(req.query.classId).trim();
      where.student = { ...(where.student || {}), class: { id: classId } } as any;
    }

    const [pins, total] = await Promise.all([
      prisma.resultPin.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          pinValue: true,
          studentId: true,
          type: true,
          status: true,
          expiresAt: true,
          generatedAt: true,
          lastValidatedAt: true,
          generatedBy: true,
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              admissionNo: true,
              class: {
                select: { id: true, name: true },
              },
            },
          },
          batch: {
            select: { id: true, batchName: true },
          },
          term: {
            select: {
              id: true,
              name: true,
              academicYear: {
                select: { name: true },
              },
            },
          },
        },
      }),
      prisma.resultPin.count({ where }),
    ]);

    res.json({ ok: true, pins, total, page, limit });
  } catch (error) {
    console.error('[result-pins] Failed to list PINs', error);
    res.status(500).json({ error: 'Failed to list PINs' });
  }
});

router.post('/pins/bulk/status', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const ids = Array.isArray((req.body as any)?.ids) ? (req.body as any).ids : [];
    const status = String((req.body as any)?.status || '').toUpperCase();
    if (!ids.length) return res.status(400).json({ error: 'ids are required' });
    if (!['ACTIVE', 'INACTIVE', 'REVOKED'].includes(status)) return res.status(400).json({ error: 'invalid status' });

    const result = await prisma.resultPin.updateMany({
      where: { id: { in: ids }, schoolId },
      data: { status },
    });

    res.json({ ok: true, updated: result.count });
  } catch (error) {
    console.error('[result-pins] Failed to bulk update status', error);
    res.status(500).json({ error: 'Failed to bulk update status' });
  }
});

router.post('/pins/bulk/delete', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const ids = Array.isArray((req.body as any)?.ids) ? (req.body as any).ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids are required' });

    const result = await prisma.resultPin.deleteMany({ where: { id: { in: ids }, schoolId } });

    res.json({ ok: true, deleted: result.count });
  } catch (error) {
    console.error('[result-pins] Failed to bulk delete pins', error);
    res.status(500).json({ error: 'Failed to bulk delete pins' });
  }
});

router.post('/pins/bulk/notify', async (req: Request, res: Response) => {
  try {
    const schoolId = await resolveSchoolId(req);
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }

    const ids = Array.isArray((req.body as any)?.ids) ? (req.body as any).ids : [];
    const selectedGuardianIds = Array.isArray((req.body as any)?.guardianIds)
      ? (req.body as any).guardianIds.filter(Boolean)
      : [];
    if (!ids.length) {
      return res.status(400).json({ error: 'ids are required' });
    }

    const validation = validateBulkPinNotificationRequest({
      pinCount: ids.length,
      guardianCount: selectedGuardianIds.length > 0 ? selectedGuardianIds.length : 1,
    });

    if (!validation.ok) {
      return res.status(400).json({ error: validation.reason });
    }

    const pins = await prisma.resultPin.findMany({
      where: { id: { in: ids }, schoolId },
      select: {
        id: true,
        pinValue: true,
        studentId: true,
        type: true,
        student: {
          select: { id: true, firstName: true, lastName: true, admissionNo: true },
        },
        term: {
          select: { id: true, name: true, academicYear: { select: { name: true } } },
        },
      },
    });

    if (!pins.length) {
      return res.status(404).json({ error: 'No matching PINs found' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, slug: true, initials: true, logoUrl: true },
    });

    const communicationService = createCommunicationService();
    const resultsUrl = resolvePublicResultsUrl(`${process.env.FRONTEND_URL || 'https://www.schoolbase.live'}/results/check`);
    const rules = communicationRulesRegistry.getRules(schoolId);
    const shouldSendPinNotifications = rules.ResultsPublished?.enabled !== false;

    if (!shouldSendPinNotifications) {
      return res.json({ ok: true, sent: 0, skipped: pins.length, message: 'PIN delivery notifications are disabled for this school' });
    }

    const pinBatches = buildBulkPinNotificationBatches({
      pinIds: ids,
      guardianCount: selectedGuardianIds.length > 0 ? selectedGuardianIds.length : 1,
    });

    let sentCount = 0;

    for (const batch of pinBatches) {
      const batchPins = pins.filter((pin) => batch.pinIds.includes(pin.id));

      for (const pin of batchPins) {
        if (!pin.studentId || !pin.student) continue;

        const pupilName = `${pin.student.firstName || ''} ${pin.student.lastName || ''}`.trim() || 'Student';
        const guardianLinks = await prisma.guardianPupil.findMany({
          where: { pupilId: pin.studentId },
          include: { guardian: true },
        });

        const guardianTargets = resolveGuardianNotificationTargets(
          guardianLinks.map((entry) => ({ guardian: entry.guardian })),
          selectedGuardianIds,
        );

        for (const target of guardianTargets) {
          const guardian = target.guardian;
          const recipients = target.recipients;

          if (!recipients.length) continue;

          const message = buildPinDeliveryWhatsAppMessage({
            guardianName: guardian.firstName || 'Guardian',
            pupilName,
            pin: pin.pinValue || '—',
            schoolName: school?.name || 'SchoolBase',
            schoolCode: school?.slug || school?.initials || undefined,
            admissionNumber: pin.student?.admissionNo || undefined,
            sessionName: pin.term?.academicYear?.name || undefined,
            termName: pin.term?.name || undefined,
            resultsUrl,
          });

          try {
            const dispatchResult = await communicationService.dispatch({
              event: 'PinDelivered',
              schoolId,
              recipients,
              template: 'Results',
              subject: 'Result PIN Ready',
              body: message,
              data: {
                pupilName,
                pin: pin.pinValue || '—',
                schoolName: school?.name || 'SchoolBase',
                schoolCode: school?.slug || school?.initials || undefined,
                admissionNumber: pin.student?.admissionNo || undefined,
                sessionName: pin.term?.academicYear?.name || undefined,
                termName: pin.term?.name || undefined,
                recipientName: guardian.firstName,
                resultsUrl,
              },
              metadata: {
                pupilName,
                pin: pin.pinValue || '—',
                schoolName: school?.name || 'SchoolBase',
                schoolCode: school?.slug || school?.initials || undefined,
                admissionNumber: pin.student?.admissionNo || undefined,
                sessionName: pin.term?.academicYear?.name || undefined,
                termName: pin.term?.name || undefined,
                recipientName: guardian.firstName,
                schoolLogoUrl: school?.logoUrl || undefined,
                resultsUrl,
                guardianId: guardian.id,
                logoUrl: school?.logoUrl || undefined,
              },
            });

            for (const delivery of dispatchResult.deliveries) {
              const status = delivery.status === 'SENT' ? 'SENT' : delivery.status === 'QUEUED' ? 'PENDING' : 'FAILED';
              await prisma.notification.create({
                data: {
                  schoolId,
                  guardianId: guardian.id,
                  type: 'RESULT_PIN_DELIVERED',
                  title: 'Result PIN Ready',
                  body: truncateNotificationBody(message),
                  channel: delivery.channel,
                  status,
                  sentAt: delivery.status === 'SENT' || delivery.status === 'QUEUED' ? new Date() : undefined,
                  failureReason: delivery.error,
                  relatedId: pin.id,
                  reference: pin.id,
                },
              });
            }

            sentCount += dispatchResult.deliveries.filter((delivery) => delivery.status === 'SENT' || delivery.status === 'QUEUED').length;
          } catch (dispatchError) {
            console.error(`[result-pins] Failed to dispatch PIN notification for guardian ${guardian.id}:`, dispatchError);
          }
        }
      }
    }

    res.json({ ok: true, sent: sentCount, total: pins.length, batches: pinBatches.length });
  } catch (error) {
    console.error('[result-pins] Failed to notify PIN recipients', error);
    res.status(500).json({ error: 'Failed to notify PIN recipients' });
  }
});

async function verifyResultPin(req: Request, res: Response) {
  try {
    const rawPin = normalizePin((req.body as any)?.pin);
    const studentId = (req.body as any)?.studentId || null;
    const termId = (req.body as any)?.termId || null;
    const assessmentId = (req.body as any)?.assessmentId || null;
    let schoolId = (req.body as any)?.schoolId || (await resolveSchoolId(req));

    if (!schoolId && studentId) {
      const pupil = await prisma.pupil.findUnique({
        where: { id: studentId },
        select: { schoolId: true },
      });
      schoolId = pupil?.schoolId || null;
    }

    if (!schoolId || !rawPin) {
      return res.status(400).json({ error: 'schoolId and pin are required' });
    }

    const { school, isEnabled } = await ensureResultPinFeatureEnabled(schoolId);
    if (!school || !isEnabled) {
      return res.status(403).json({ error: 'Result PIN access is disabled for this school' });
    }

    const candidates = await prisma.resultPin.findMany({
      where: {
        schoolId,
        status: 'ACTIVE',
        OR: [
          studentId ? { studentId } : {},
          { studentId: null },
        ],
        ...(termId ? { termId } : {}),
        ...(assessmentId ? { assessmentId } : {}),
      },
      orderBy: { generatedAt: 'desc' },
    });

    for (const candidate of candidates) {
      const isExpired = candidate.expiresAt ? new Date(candidate.expiresAt).getTime() < Date.now() : false;
      if (isExpired) {
        continue;
      }

      const matches = await bcrypt.compare(rawPin, candidate.pinHash);
      if (matches) {
        await prisma.resultPin.update({
          where: { id: candidate.id },
          data: {
            lastValidatedAt: new Date(),
          },
        });

        return res.json({
          ok: true,
          valid: true,
          pinType: candidate.type,
          studentId: candidate.studentId,
          termId: candidate.termId,
          assessmentId: candidate.assessmentId,
          pinId: candidate.id,
        });
      }
    }

    res.json({ ok: true, valid: false });
  } catch (error) {
    console.error('[result-pins] Failed to verify PIN', error);
    res.status(500).json({ error: 'Failed to verify PIN' });
  }
}

router.post('/verify', verifyResultPin);

router.post('/verify-pin', verifyResultPin);

router.post('/check', verifyResultPin);

export default router;
