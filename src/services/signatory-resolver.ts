import { PrismaClient } from '@prisma/client';

// Some editor / generated-client setups can show the model accessors
// as missing even after `prisma generate`. Use a narrow augmentation
// type locally so the resolver remains strongly-typed while avoiding
// spurious editor diagnostics in workspaces where the generated client
// isn't picked up by the language server yet.
type PrismaClientWithSignatory = PrismaClient & { signatory?: any };

export type ResolvedSignatory = {
  signatoryId?: string | null;
  name?: string | null;
  title?: string | null;
  signatureUrl?: string | null;
  comment?: string | null;
  source: 'explicit' | 'phase' | 'none';
};

/**
 * Resolve the report signatory for a given pupil within a tenant (school).
 * Precedence:
 * 1. explicitSignatoryId (if valid and belongs to school and active)
 * 2. active Signatory configured for the student's Class.phase
 * 3. School.principalSignatureUrl (principal data)
 * 4. none (no signature)
 */
export async function resolveReportSignatory(options: {
  prisma: PrismaClientWithSignatory;
  schoolId: string;
  pupilId?: string | null;
  explicitSignatoryId?: string | null;
}): Promise<ResolvedSignatory> {
  const { prisma, schoolId, pupilId, explicitSignatoryId } = options;

  // 1) explicit override
  if (explicitSignatoryId) {
    const s = await prisma.signatory.findFirst({
      where: { id: explicitSignatoryId, schoolId, active: true },
    });

    if (s) {
      return {
        signatoryId: s.id,
        name: s.name,
        title: s.title,
        comment: (s as any).comment ?? null,
        signatureUrl: s.signatureUrl,
        source: 'explicit',
      };
    }
    // fallthrough to next precedence if explicit invalid
  }

  // 2) phase-configured signatory (requires pupil -> class -> phase)
  if (pupilId) {
    const pupil = await prisma.pupil.findUnique({
      where: { id: pupilId },
      include: { class: true },
    });

    if (pupil && pupil.classId && pupil.class) {
      const phase = pupil.class.phase;
      if (phase) {
        const phaseSignatory = await prisma.signatory.findFirst({
          where: { schoolId, phase, active: true },
          orderBy: { createdAt: 'desc' },
        });

        if (phaseSignatory) {
          return {
            signatoryId: phaseSignatory.id,
            name: phaseSignatory.name,
            title: phaseSignatory.title,
            comment: (phaseSignatory as any).comment ?? null,
            signatureUrl: phaseSignatory.signatureUrl,
            source: 'phase',
          };
        }
        // Fallback: some existing signatory records may have the phase stored
        // in a slightly different string format (legacy/label). Try a JS-side
        // normalization lookup across active signatories for the school.
        const allSignatories = await prisma.signatory.findMany({ where: { schoolId, active: true } });
        const normalize = (v: any) => (v ? String(v).toLowerCase().replace(/[^a-z0-9]/g, '') : '');
        const target = normalize(phase);
        const fuzzy = allSignatories.find((s: any) => normalize((s as any).phase) === target || normalize((s as any).phase) === normalize(phase.replace('_', '')));
        if (fuzzy) {
          // eslint-disable-next-line no-console
          console.warn(`Signatory resolver: using fuzzy phase match for phase=${phase} -> signatory=${fuzzy.id}`);
          return {
            signatoryId: fuzzy.id,
            name: fuzzy.name,
            title: fuzzy.title,
            comment: (fuzzy as any).comment ?? null,
            signatureUrl: fuzzy.signatureUrl,
            source: 'phase',
          };
        }
      }
    }
  }

  // No signatory found (do not fall back to School principal fields anymore)
  return { source: 'none' };
}

export default resolveReportSignatory;
