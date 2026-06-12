import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import ReportCardService from '../services/report-card.service.js';
import { verifyAuth, AuthenticatedRequest } from '../middleware/roleAuth.js';

const router = Router();
const prisma = new PrismaClient();
const reportCardService = new ReportCardService(prisma);

/**
 * Report Card API Routes - Phase 4
 * 
 * Handles:
 * - Generate individual report cards
 * - Generate bulk report cards
 * - Get report card summaries
 * - Get class statistics
 */

// Apply authentication middleware to all routes
router.use(verifyAuth);

// GET /api/report-cards/:assessmentId/:pupilId
// Get report card for a specific student
router.get('/:assessmentId/:pupilId', async (req: AuthenticatedRequest, res) => {
  try {
    const { assessmentId, pupilId } = req.params;
    const schoolId = req.user?.schoolId;

    if (!schoolId || !assessmentId || !pupilId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const reportCard = await reportCardService.generateReportCard(
      assessmentId,
      pupilId,
      schoolId
    );

    res.json(reportCard);
  } catch (error: any) {
    console.error('Error generating report card:', error);
    res.status(500).json({ error: error.message || 'Failed to generate report card' });
  }
});

// GET /api/report-cards/assessment/:assessmentId
// Get report card summary for all students in an assessment
router.get('/assessment/:assessmentId/summaries', async (req: AuthenticatedRequest, res) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = req.user?.schoolId;

    if (!schoolId || !assessmentId) {
      return res.status(400).json({ error: 'Missing school ID or assessment ID' });
    }

    const summaries = await reportCardService.getReportCardSummaries(
      assessmentId,
      schoolId
    );

    res.json(summaries);
  } catch (error: any) {
    console.error('Error fetching report card summaries:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch summaries' });
  }
});

// GET /api/report-cards/assessment/:assessmentId/bulk
// Generate all report cards for an assessment
router.get('/assessment/:assessmentId/bulk', async (req: AuthenticatedRequest, res) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = req.user?.schoolId;

    if (!schoolId || !assessmentId) {
      return res.status(400).json({ error: 'Missing school ID or assessment ID' });
    }

    const reportCards = await reportCardService.generateBulkReportCards(
      assessmentId,
      schoolId
    );

    res.json({
      assessmentId,
      totalReportCards: reportCards.length,
      reportCards,
    });
  } catch (error: any) {
    console.error('Error generating bulk report cards:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to generate report cards' });
  }
});

// GET /api/report-cards/assessment/:assessmentId/statistics
// Get class statistics for an assessment
router.get('/assessment/:assessmentId/statistics', async (req: AuthenticatedRequest, res) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = req.user?.schoolId;

    if (!schoolId || !assessmentId) {
      return res.status(400).json({ error: 'Missing school ID or assessment ID' });
    }

    const statistics = await reportCardService.getClassStatistics(
      assessmentId,
      schoolId
    );

    res.json(statistics);
  } catch (error: any) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
  }
});

export default router;
