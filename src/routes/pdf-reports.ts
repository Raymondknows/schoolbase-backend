import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { jwtVerify } from 'jose';
import PDFReportCardService from '../services/pdf-report-card.service.js';
import { getSessionSecret } from '../services/security-config.js';
import { resolveSchoolScope } from '../services/security-context.js';

const router = Router();
const prisma = new PrismaClient();
const pdfService = new PDFReportCardService(prisma);

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

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
      console.error('[pdf-reports] Failed to resolve schoolId from token', error);
    }
  }

  const scope = resolveSchoolScope({ authenticatedSchoolId, authenticatedRole, requestedSchoolId });
  if (scope.rejected) {
    console.warn('[pdf-reports] Rejected cross-school scope request');
    return null;
  }

  return scope.schoolId;
}

/**
 * PDF Report Card API Routes - Phase 6
 * 
 * Handles:
 * - Generate single report card PDF
 * - Generate bulk report card PDFs
 * - Generate class ranking PDF
 */

// GET /api/pdf-reports/:assessmentId/:pupilId
// Download report card PDF for a student
router.get('/:assessmentId/:pupilId', async (req: Request, res: Response) => {
  try {
    const { assessmentId, pupilId } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !assessmentId || !pupilId) {
      return res.status(403).json({ error: 'School scope verification failed' });
    }

    // Get pupil for filename
    const pupil = await prisma.pupil.findFirst({
      where: { id: pupilId, schoolId },
    });

    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: { term: { include: { academicYear: true } } },
    });

    if (!pupil || !assessment) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const explicitSignatoryId = req.query.signatoryId as string | undefined;
    const explicitSignatoryMode = (req.query.signatoryMode as string | undefined) ?? null;

    const pdfBytes = await pdfService.generateReportCardPDF(
      assessmentId,
      pupilId,
      schoolId,
      explicitSignatoryId ?? null,
      explicitSignatoryMode === 'principal' ? 'principal' : null
    );

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    const studentName = sanitizeFilename(`${pupil.firstName}_${pupil.lastName}`);
    const assessmentLabel = sanitizeFilename(assessment.name || assessment.term?.name || 'report');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${studentName}_${assessmentLabel}.pdf"`
    );
    res.setHeader('Content-Length', pdfBytes.length);

    res.send(Buffer.from(pdfBytes));
  } catch (error: any) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: error.message || 'Failed to generate PDF' });
  }
});

// GET /api/pdf-reports/bulk/:assessmentId
// Download all report card PDFs for an assessment as separate files
// NOTE: For production, consider returning a ZIP file instead
router.get('/bulk/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !assessmentId) {
      return res.status(403).json({ error: 'School scope verification failed' });
    }

    const explicitSignatoryId = req.query.signatoryId as string | undefined;
    const explicitSignatoryMode = (req.query.signatoryMode as string | undefined) ?? null;

    const pdfMap = await pdfService.generateBulkReportCardPDFs(
      assessmentId,
      schoolId,
      explicitSignatoryId ?? null,
      explicitSignatoryMode === 'principal' ? 'principal' : null
    );

    res.json({
      success: true,
      assessmentId,
      totalPDFs: pdfMap.size,
      files: Array.from(pdfMap.keys()),
      message: 'Download individual PDFs using /:assessmentId/:pupilId endpoint',
    });
  } catch (error: any) {
    console.error('Error generating bulk PDFs:', error);
    res.status(500).json({ error: error.message || 'Failed to generate PDFs' });
  }
});

// GET /api/pdf-reports/ranking/:assessmentId
// Download class ranking PDF
router.get('/ranking/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId || !assessmentId) {
      return res.status(403).json({ error: 'School scope verification failed' });
    }

    const pdfBytes = await pdfService.generateClassRankingPDF(
      assessmentId,
      schoolId
    );

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="class_ranking_${assessmentId}.pdf"`
    );
    res.setHeader('Content-Length', pdfBytes.length);

    res.send(Buffer.from(pdfBytes));
  } catch (error: any) {
    console.error('Error generating ranking PDF:', error);
    res.status(500).json({ error: error.message || 'Failed to generate PDF' });
  }
});

export default router;
