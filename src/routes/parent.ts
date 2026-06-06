import { Router, Request, Response } from 'express';
import { SignJWT } from 'jose';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

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

export default router;
