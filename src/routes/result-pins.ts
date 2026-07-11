import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

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
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);

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

    const pins = await prisma.resultPin.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
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
    });

    res.json({ ok: true, pins });
  } catch (error) {
    console.error('[result-pins] Failed to list PINs', error);
    res.status(500).json({ error: 'Failed to list PINs' });
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
