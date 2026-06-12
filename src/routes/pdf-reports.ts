import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import PDFReportCardService from '../services/pdf-report-card.service.js';

const router = Router();
const prisma = new PrismaClient();
const pdfService = new PDFReportCardService(prisma);

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
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !assessmentId || !pupilId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Get pupil for filename
    const pupil = await prisma.pupil.findUnique({
      where: { id: pupilId },
    });

    if (!pupil) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const pdfBytes = await pdfService.generateReportCardPDF(
      assessmentId,
      pupilId,
      schoolId
    );

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${pupil.firstName}_${pupil.lastName}_reportcard.pdf"`
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
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !assessmentId) {
      return res.status(400).json({ error: 'Missing school ID or assessment ID' });
    }

    const pdfMap = await pdfService.generateBulkReportCardPDFs(assessmentId, schoolId);

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
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !assessmentId) {
      return res.status(400).json({ error: 'Missing school ID or assessment ID' });
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
