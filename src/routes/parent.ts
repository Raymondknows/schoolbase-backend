import { Router, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resolveSupportedCurrency } from '../services/currency.js';

const router = Router();
const prisma = new PrismaClient() as PrismaClient & {
  resultPin: any;
  resultPinBatch: any;
};

function secret() {
  return new TextEncoder().encode(
    process.env.SESSION_SECRET ?? 'schoolbase-dev-secret-change-me',
  );
}

function normalizePhone(phone: string, country?: string) {
  const cleaned = phone.trim().replace(/\s+/g, '').replace(/[^+\d]/g, '');
  if (!cleaned) return '';
  const normalized = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (normalized.startsWith('+')) {
    return normalized;
  }

  if (normalized.startsWith('0')) {
    const countryCodes: Record<string, string> = {
      NG: '+234',
      GH: '+233',
      RW: '+250',
    };
    const code = country ? countryCodes[country.toUpperCase()] : undefined;
    if (code) {
      return `${code}${normalized.slice(1)}`;
    }
  }

  return normalized;
}

function buildLoginPhoneCandidates(phone: string, country?: string) {
  const normalized = normalizePhone(phone, country);
  const candidates = new Set<string>();
  if (!normalized) return [];

  candidates.add(normalized);
  if (normalized.startsWith('+')) {
    const match = normalized.match(/^\+(\d{1,3})(\d+)$/);
    if (match) {
      candidates.add(`0${match[2]}`);
    }
  } else if (normalized.startsWith('0')) {
    const countryCodes: Record<string, string> = {
      NG: '+234',
      GH: '+233',
      RW: '+250',
    };
    const code = country ? countryCodes[country.toUpperCase()] : undefined;
    if (code) {
      candidates.add(`${code}${normalized.slice(1)}`);
    }

    if (!country) {
      candidates.add(`+234${normalized.slice(1)}`);
      candidates.add(`+233${normalized.slice(1)}`);
      candidates.add(`+250${normalized.slice(1)}`);
    }
  }

  return Array.from(candidates);
}

function normalizeAdmission(admissionNo: string) {
  return admissionNo.replace(/\W+/g, '').toLowerCase();
}

async function signToken(payload: Record<string, unknown>) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body.phone ?? '').trim();
    const admissionNo = String(req.body.admissionNo ?? '').trim();
    const schoolSlug = String(req.body.schoolSlug ?? '').trim();

    let country: string | undefined;
    if (schoolSlug) {
      const school = await prisma.school.findUnique({
        where: { slug: schoolSlug },
        select: { country: true },
      });
      country = school?.country ?? undefined;
    }

    const inputAdm = normalizeAdmission(admissionNo);
    let guardianRecord: any | null = null;

    if (inputAdm) {
      const pupilWhere: any = schoolSlug
        ? { school: { slug: schoolSlug }, admissionNo: { contains: admissionNo } }
        : { admissionNo: { contains: admissionNo } };

      const pupils = await prisma.pupil.findMany({
        where: pupilWhere,
        include: { guardians: { include: { guardian: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const matchedPupil = pupils.find((pupil) => {
        const stored = pupil.admissionNo ?? '';
        const normStored = normalizeAdmission(stored);
        return (
          normStored === inputAdm ||
          normStored.startsWith(inputAdm) ||
          inputAdm.startsWith(normStored)
        );
      });

      if (matchedPupil) {
        const phoneCandidates = phone ? buildLoginPhoneCandidates(phone, country) : [];

        if (phoneCandidates.length > 0) {
          for (const gp of matchedPupil.guardians) {
            const guardian = gp.guardian;
            if (!guardian) continue;
            const gPhones = [guardian.phone, guardian.whatsapp].filter(Boolean) as string[];
            if (gPhones.some((value) => phoneCandidates.includes(value))) {
              guardianRecord = guardian;
              break;
            }
          }
        }

        if (!guardianRecord) {
          guardianRecord =
            matchedPupil.guardians.map((gp) => gp.guardian).find((g) => g?.whatsapp) ||
            matchedPupil.guardians.map((gp) => gp.guardian).find((g) => g?.phone) ||
            matchedPupil.guardians.map((gp) => gp.guardian)[0] ||
            null;
        }
      }

      if (guardianRecord) {
        const token = await signToken({
          guardianId: guardianRecord.id,
          schoolId: matchedPupil?.schoolId ?? guardianRecord.schoolId,
          name: `${guardianRecord.firstName} ${guardianRecord.lastName}`,
          phone: guardianRecord.whatsapp || guardianRecord.phone || '',
        });

        return res.json({ success: true, token });
      }
    }

    const phoneCandidates = buildLoginPhoneCandidates(phone, country);
    if (phoneCandidates.length === 0) {
      return res.status(400).json({ error: 'Phone number not found. Contact the school.' });
    }

    const predicate = phoneCandidates.flatMap((value) => [
      { phone: value },
      { whatsapp: value },
    ]);

    const whereCondition = schoolSlug
      ? { school: { slug: schoolSlug }, OR: predicate }
      : { OR: predicate };

    const guardian = await prisma.guardian.findFirst({
      where: whereCondition,
      include: { school: true, pupils: { include: { pupil: true } } },
    });

    if (!guardian) {
      return res.status(404).json({ error: 'Phone number not found. Contact the school.' });
    }

    if (inputAdm) {
      const admissionMatch = guardian.pupils.some((gp) => {
        const stored = gp.pupil.admissionNo ?? '';
        const normStored = normalizeAdmission(stored);
        return (
          normStored === inputAdm ||
          normStored.startsWith(inputAdm) ||
          inputAdm.startsWith(normStored)
        );
      });

      if (!admissionMatch) {
        return res.status(400).json({ error: 'Admission number does not match this phone.' });
      }
    }

    const token = await signToken({
      guardianId: guardian.id,
      schoolId: guardian.schoolId,
      name: `${guardian.firstName} ${guardian.lastName}`,
      phone: guardian.whatsapp || guardian.phone || '',
    });

    res.json({ success: true, token });
  } catch (error) {
    console.error('Parent login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify parent session
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.json({ authenticated: false });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    return res.json({
      authenticated: true,
      guardianId: data.guardianId,
      name: data.name,
      phone: data.phone,
      schoolId: data.schoolId,
    });
  } catch (error) {
    res.json({ authenticated: false });
  }
});

// Get parent dashboard data
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: { 
        pupils: { 
          include: { 
            pupil: { 
              include: { 
                class: true,
              } 
            } 
          } 
        },
        school: true
      },
    });

    if (!guardian) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const children = guardian.pupils.map((gp: any) => ({
      id: gp.pupil.id,
      firstName: gp.pupil.firstName,
      lastName: gp.pupil.lastName,
      admissionNo: gp.pupil.admissionNo,
      class: gp.pupil.class,
      status: gp.pupil.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
      latestGrade: null,
    }));

    // Get invoices for all children
    const invoices = await prisma.invoice.findMany({
      where: {
        pupilId: { in: children.map((c: any) => c.id) },
      },
      include: { pupil: true },
    });

    const outstandingFees = invoices
      .filter(inv => ['SENT', 'PART_PAID', 'OVERDUE'].includes(inv.status))
      .reduce((sum, inv) => sum + inv.amountDue, 0);

    // Get announcements
    const announcements = await prisma.announcement.findMany({
      where: { 
        schoolId: data.schoolId,
        published: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    res.json({
      guardianName: `${guardian.firstName} ${guardian.lastName}`,
      children,
      outstandingFees,
      announcements: announcements.map(a => ({
        id: a.id,
        title: a.title,
        content: a.body,
        createdAt: a.createdAt,
      })),
      recentResults: [],
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// Get parent's children
router.get('/children', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: {
        pupils: {
          include: {
            pupil: {
              include: {
                class: true,
              },
            },
          },
        },
      },
    });

    if (!guardian) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    // Get invoices for children
    const invoices = await prisma.invoice.findMany({
      where: {
        pupilId: { in: guardian.pupils.map((gp: any) => gp.pupil.id) },
      },
    });

    const children = guardian.pupils.map((gp: any) => ({
      id: gp.pupil.id,
      firstName: gp.pupil.firstName,
      lastName: gp.pupil.lastName,
      admissionNo: gp.pupil.admissionNo,
      class: gp.pupil.class,
      status: gp.pupil.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
      latestGrade: null,
      outstandingFee: invoices
        .filter(inv => inv.pupilId === gp.pupil.id && ['SENT', 'PART_PAID', 'OVERDUE'].includes(inv.status))
        .reduce((sum, inv) => sum + inv.amountDue, 0),
    }));

    res.json({ children });
  } catch (error) {
    console.error('Error loading children:', error);
    res.status(500).json({ error: 'Failed to load children' });
  }
});

// Get child's attendance for today or recent records
router.get('/attendance/:childId', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const childId = req.params.childId;
    const days = req.query.days ? parseInt(req.query.days as string) : 7;

    // Verify parent has access to this child
    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: {
        pupils: {
          include: {
            pupil: { select: { id: true } }
          }
        }
      }
    });

    if (!guardian || !guardian.pupils.some(gp => gp.pupil.id === childId)) {
      return res.status(403).json({ error: 'Unauthorized access to this child' });
    }

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);

    // Get attendance records for the period
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        pupilId: childId,
        date: {
          gte: fromDate,
        },
      },
      orderBy: { date: 'desc' },
      take: 50,
    });

    // Get today's attendance if it exists
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayAttendance = attendanceRecords.find(
      a => new Date(a.date).getTime() === today.getTime()
    );

    // Calculate attendance percentage for the period
    const totalRecords = attendanceRecords.length;
    const presentCount = attendanceRecords.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length;
    const attendancePercentage = totalRecords > 0 ? Math.round((presentCount / totalRecords) * 100) : null;

    res.json({
      todayStatus: todayAttendance?.status || null,
      todayDate: todayAttendance?.date || null,
      attendancePercentage,
      recentRecords: attendanceRecords.slice(0, 10).map(a => ({
        date: a.date,
        status: a.status,
      })),
    });
  } catch (error) {
    console.error('Error loading attendance:', error);
    res.status(500).json({ error: 'Failed to load attendance' });
  }
});

// Get available terms
router.get('/terms', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    // Get school from guardian's children
    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: { 
        pupils: { 
          include: { 
            pupil: { 
              select: { 
                schoolId: true 
              } 
            } 
          } 
        } 
      },
    });

    if (!guardian || guardian.pupils.length === 0) {
      return res.json({ terms: [] });
    }

    const schoolId = guardian.pupils[0].pupil.schoolId;

    const terms = await prisma.term.findMany({
      where: {
        academicYear: {
          schoolId,
          isCurrent: true,
        },
      },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true },
    });

    res.json({ terms });
  } catch (error) {
    console.error('Error fetching terms:', error);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

async function ensureResultPinAccess(childId: string, suppliedPin?: string | null, termId?: string | null) {
  const child = await prisma.pupil.findUnique({
    where: { id: childId },
    select: { id: true, schoolId: true },
  });

  if (!child) {
    return { allowed: false, requiresPin: false, error: 'Student not found' };
  }

  const school = await prisma.school.findUnique({
    where: { id: child.schoolId },
    select: {
      id: true,
      resultAccessPinEnabled: true,
      resultAccessMode: true,
    },
  });

  if (!school || !school.resultAccessPinEnabled) {
    return { allowed: true, requiresPin: false, matchedPinTermId: null };
  }

  const mode = school.resultAccessMode || 'NONE';
  // Parent portal access should not be blocked by PUBLIC_CHECKER_ONLY mode
  // Mode only affects public result checking, not authenticated parent portal access
  // If PIN is enabled, we'll require it below

  // Allow parent portal access if PIN is enabled (modes: NONE, PARENT_PORTAL_ONLY, BOTH)
  // If no PIN is supplied, request one
  const normalizedPin = String(suppliedPin ?? '').trim();
  if (!normalizedPin) {
    return { allowed: false, requiresPin: true, error: 'Result PIN required', matchedPinTermId: null };
  }

  const candidates = await prisma.resultPin.findMany({
    where: {
      schoolId: child.schoolId,
      status: 'ACTIVE',
      OR: [
        { studentId: child.id },
        { studentId: null },
      ],
      ...(termId ? { termId } : {}),
    },
    select: {
      id: true,
      pinHash: true,
      type: true,
      studentId: true,
      expiresAt: true,
      termId: true,
    },
    orderBy: { generatedAt: 'desc' },
  });

  const now = Date.now();
  for (const candidate of candidates) {
    if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < now) {
      continue;
    }

    const matches = await bcrypt.compare(normalizedPin, candidate.pinHash);
    if (matches) {
      if (candidate.type === 'GENERIC' && !candidate.studentId) {
        await prisma.resultPin.update({
          where: { id: candidate.id },
          data: { studentId: child.id, assignedAt: new Date() },
        });
      }

      return { allowed: true, requiresPin: false, matchedPinTermId: candidate.termId ?? null };
    }
  }

  return { allowed: false, requiresPin: false, error: 'Invalid result PIN', matchedPinTermId: null };
}

// Get child results by term and assessment
router.get('/results', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));

    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const childId = req.query.childId as string;
    const termId = req.query.termId as string;
    const suppliedPin = req.query.pin as string | undefined;

    if (!childId) {
      return res.status(400).json({ error: 'childId required' });
    }

    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: {
        pupils: {
          include: {
            pupil: {
              select: { id: true }
            }
          }
        }
      }
    });

    if (!guardian || !guardian.pupils.some((gp: any) => gp.pupil.id === childId)) {
      return res.status(403).json({ error: 'Unauthorized access to this child' });
    }

    const accessCheck = await ensureResultPinAccess(childId, suppliedPin, termId || null);
    if (!accessCheck.allowed) {
      if (accessCheck.requiresPin) {
        return res.status(403).json({ error: accessCheck.error || 'Result PIN required', requiresPin: true });
      }

      return res.status(403).json({ error: accessCheck.error || 'Result PIN validation failed', requiresPin: false });
    }

    const effectiveTermId = termId && termId !== 'latest' ? termId : accessCheck.matchedPinTermId || null;

    // Get child's school and phase
    const child = await prisma.pupil.findUnique({
      where: { id: childId },
      include: {
        class: {
          select: { phase: true, schoolId: true }
        }
      }
    });

    if (!child || !child.class) {
      return res.json({ results: [], term: null });
    }

    // Build where clause for assessments
    const where: any = {
      schoolId: child.class.schoolId,
      phase: child.class.phase,
      status: 'PUBLISHED',
    };

    // If a term was explicitly selected, or the PIN corresponds to a specific term, filter to it.
    if (effectiveTermId && effectiveTermId !== 'latest') {
      where.termId = effectiveTermId;
    }

    // Get the assessments (and their results for this child)
    const assessments = await prisma.assessment.findMany({
      where,
      include: {
        term: {
          select: { id: true, name: true }
        },
        results: {
          where: { pupilId: childId },
          select: {
            id: true,
            caScore: true,
            testScore: true,
            examScore: true,
            totalScore: true,
          }
        }
      },
      orderBy: [
        { term: { sortOrder: 'desc' } },
        { createdAt: 'desc' }
      ]
    });

    // Determine which term to display (latest or selected)
    let selectedTerm = null;
    let filteredAssessments = assessments;

    if (!effectiveTermId || effectiveTermId === 'latest') {
      // Group by term and get latest
      const groupedByTerm = new Map<string, any[]>();
      assessments.forEach((a) => {
        if (a.term) {
          if (!groupedByTerm.has(a.term.id)) {
            groupedByTerm.set(a.term.id, []);
          }
          groupedByTerm.get(a.term.id)!.push(a);
        }
      });

      // Get the latest term by sort order when no explicit term has been requested.
      const latestTerm = assessments
        .map((assessment) => assessment.term)
        .filter((term): term is { id: string; name: string; sortOrder?: number | null } => Boolean(term))
        .sort((a, b) => (b.sortOrder ?? 0) - (a.sortOrder ?? 0))[0] ?? null;

      if (latestTerm) {
        selectedTerm = latestTerm;
        filteredAssessments = assessments.filter((assessment) => assessment.term?.id === latestTerm.id);
      }
    } else {
      selectedTerm = assessments.find((assessment) => assessment.term?.id === effectiveTermId)?.term || null;
      filteredAssessments = assessments.filter((assessment) => assessment.term?.id === effectiveTermId);
    }

    // Transform results - flatten assessment results into subjects
    const results = filteredAssessments
      .filter(a => a.results.length > 0)
      .map(assessment => {
        const result = assessment.results[0];
        return {
          id: result.id,
          subject: assessment.name,
          assessmentId: assessment.id,
          caScore: result.caScore,
          testScore: result.testScore,
          examScore: result.examScore,
          totalScore: result.totalScore,
          grade: result.totalScore ? getGrade(result.totalScore) : null,
        };
      });

    res.json({ 
      results,
      term: selectedTerm,
      assessments: filteredAssessments
    });
  } catch (error) {
    console.error('Error loading results:', error);
    res.status(500).json({ error: 'Failed to load results' });
  }
});

// Get invoices
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: { pupils: { include: { pupil: true } } },
    });

    if (!guardian) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        pupilId: { in: guardian.pupils.map((gp: any) => gp.pupil.id) },
      },
      include: { 
        pupil: true,
        feeSchedule: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      invoices: invoices.map(inv => ({
        id: inv.id,
        childId: inv.pupilId,
        childName: `${inv.pupil.firstName} ${inv.pupil.lastName}`,
        amountDue: inv.amountDue,
        status: inv.status,
        dueDate: inv.dueDate,
        description: inv.feeSchedule?.name || 'School Fees',
      })),
    });
  } catch (error) {
    console.error('Error loading invoices:', error);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

// Get payments
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: { pupils: true },
    });

    if (!guardian) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const payments = await prisma.payment.findMany({
      where: {
        invoice: {
          pupilId: { in: guardian.pupils.map((gp: any) => gp.pupilId) },
        },
      },
      include: { invoice: true },
      orderBy: { paidAt: 'desc' },
      take: 50,
    });

    res.json({
      payments: payments.map(p => ({
        id: p.id,
        invoiceId: p.invoiceId,
        amount: p.amount,
        paidAt: p.paidAt,
        method: p.method || 'UNKNOWN',
        reference: p.reference,
      })),
    });
  } catch (error) {
    console.error('Error loading payments:', error);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

// Get announcements
router.get('/announcements', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const announcements = await prisma.announcement.findMany({
      where: { 
        schoolId: data.schoolId,
        published: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      announcements: announcements.map(a => ({
        id: a.id,
        title: a.title,
        body: a.body,
        publishedAt: a.publishedAt,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error loading announcements:', error);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// Get school info
router.get('/school', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));
    
    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;

    const school = await prisma.school.findUnique({
      where: { id: data.schoolId },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.json({
      id: school.id,
      name: school.name,
      address: school.address || '',
      phone: school.phone || '',
      email: school.email || '',
      principal: school.principalName || '',
        motto: school.tagline || '',
        manualPaymentAccountName: school.manualPaymentAccountName || '',
        manualPaymentAccountNumber: school.manualPaymentAccountNumber || '',
        manualPaymentBankName: school.manualPaymentBankName || '',
      city: school.city || '',
      country: school.country || 'NG',
      currency: resolveSupportedCurrency(school.currency),
      initials: school.initials || '',
      termCount: school.termCount,
      logoUrl: school.logoUrl || '',
      principalComment: school.principalComment || '',
    });
  } catch (error) {
    console.error('Error loading school:', error);
    res.status(500).json({ error: 'Failed to load school' });
  }
});

// Get invoice details
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').find(c => c.trim().startsWith('schoolbase_session='));

    if (!sessionCookie) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = sessionCookie.split('=')[1];
    const { payload } = await jwtVerify(token, secret());
    const data = payload as any;
    const { id } = req.params;

    const guardian = await prisma.guardian.findUnique({
      where: { id: data.guardianId },
      include: { pupils: { include: { pupil: true } } },
    });

    if (!guardian) {
      return res.status(404).json({ error: 'Guardian not found' });
    }

    const allowedPupilIds = guardian.pupils.map((gp: any) => gp.pupil.id);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        pupilId: { in: allowedPupilIds },
      },
      include: {
        pupil: {
          include: { class: true },
        },
        feeSchedule: {
          include: {
            term: { include: { academicYear: true } },
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const school = await prisma.school.findUnique({
      where: { id: data.schoolId },
      select: {
        name: true,
        currency: true,
        address: true,
        city: true,
        phone: true,
        email: true,
        logoUrl: true,
        principalName: true,
        tagline: true,
        principalComment: true,
      },
    });

    res.json({
      invoice: {
        ...invoice,
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
        payments: invoice.payments.map((payment) => ({
          ...payment,
          paidAt: payment.paidAt.toISOString(),
        })),
      },
      school,
      outstanding: Math.max(0, invoice.amountDue - invoice.amountPaid),
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Helper function to calculate grade
function getGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export default router;
