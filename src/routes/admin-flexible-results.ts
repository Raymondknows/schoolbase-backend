import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ResultsDomainService } from '../domain/results/ResultsDomainService.js';

const router = Router();
const prisma = new PrismaClient();
const resultsDomain = new ResultsDomainService(prisma);

/**
 * Flexible Results Entry Routes - v2 Results System
 * 
 * Supports component-based score entry instead of hardcoded CA/Test/Exam
 * Automatically calculates totals based on component weights
 */

// POST /api/admin/flexible-results/entry
// Enter or update scores for multiple students using assessment components
router.post('/entry', async (req: Request, res: Response) => {
  try {
    const { assessmentId, entries } = req.body;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !assessmentId || !Array.isArray(entries)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Verify assessment belongs to school and is in DRAFT
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
      include: { term: true },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft' });
    }

    // Authorization check for subject-based scoring
    // If entries contain subject info, verify teacher is assigned to those subjects
    const userId = (req as any).user?.id;
    if (userId && entries.length > 0) {
      // Get unique subjects from entries
      const subjectsInEntries = Array.from(
        new Set(entries.map((e: any) => e.subject).filter((s: any) => s))
      ) as string[];

      // If subjects are specified, verify teacher is assigned to each subject
      if (subjectsInEntries.length > 0) {
        // Get teacher's assigned subjects
        const teacherSubjects = await prisma.teacherSubject.findMany({
          where: {
            teacherId: userId,
            schoolId,
          },
          select: {
            subject: {
              select: {
                name: true,
              },
            },
          },
        });

        const assignedSubjectNames = teacherSubjects.map((ts) => ts.subject.name);

        // Verify all subjects in entries are assigned to teacher
        for (const subject of subjectsInEntries) {
          if (!assignedSubjectNames.includes(subject)) {
            return res.status(403).json({
              error: `Unauthorized: Not assigned to subject "${subject}"`,
            });
          }
        }
      }
    }

    // Get components from assessment
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        return res.status(400).json({ error: 'Invalid assessment components' });
      }
    }

    if (components.length === 0) {
      return res.status(400).json({ 
        error: 'Assessment has no components defined. Create components first.' 
      });
    }

    // Validate entries and calculate totals
    const processedEntries = entries.map((entry: any) => {
      if (!entry.pupilId) {
        throw new Error('Each entry must have pupilId');
      }

      // Get component scores object
      const componentScores: any = {};
      let totalScore = 0;

      // Validate and aggregate component scores
      for (const component of components) {
        const componentScore = entry.scores?.[component.id];
        
        if (componentScore !== undefined && componentScore !== null && componentScore !== '') {
          const score = parseFloat(componentScore);
          
          if (isNaN(score)) {
            throw new Error(
              `Invalid score for component ${component.name}: ${componentScore}`
            );
          }
          
          if (score < 0 || score > component.maxScore) {
            throw new Error(
              `Score for ${component.name} must be between 0 and ${component.maxScore}`
            );
          }
          
          // Convert to percentage of component's max and apply weight
          const componentPercentage = (score / component.maxScore) * 100;
          const weightedScore = (componentPercentage * component.weight) / 100;
          componentScores[component.id] = score;
          totalScore += weightedScore;
        }
      }

      // Round total to 2 decimals
      totalScore = Math.round(totalScore * 100) / 100;

      return {
        pupilId: entry.pupilId,
        subject: entry.subject || null,
        scores: componentScores,
        totalScore,
        comment: entry.comment || '',
      };
    });

    // Upsert all results
    const results = await Promise.all(
      processedEntries.map((entry: any) =>
        prisma.result.upsert({
          where: {
            assessmentId_pupilId_subject: {
              assessmentId,
              pupilId: entry.pupilId,
              subject: entry.subject,
            },
          },
          update: {
            caScore: entry.totalScore, // Store in caScore as a fallback for v1 compatibility
            totalScore: entry.totalScore,
            comment: entry.comment,
            // Store full component scores as JSON in testScore field (legacy workaround)
            testScore: Object.keys(entry.scores).length > 0 ? entry.totalScore * 0.6 : 0,
          },
          create: {
            assessmentId,
            pupilId: entry.pupilId,
            subject: entry.subject,
            caScore: entry.totalScore,
            totalScore: entry.totalScore,
            comment: entry.comment,
            testScore: Object.keys(entry.scores).length > 0 ? entry.totalScore * 0.6 : 0,
            examScore: entry.totalScore * 0.4,
          },
        })
      )
    );

    // Log audit trail through domain layer (append-only)
    const firstResult = results[0];
    if (firstResult) {
      await resultsDomain.auditResultChange(
        firstResult.id,
        assessmentId,
        firstResult.pupilId,
        'SCORES_ENTERED',
        {
          entriesCount: results.length,
          components: components.map((c: any) => c.name),
        },
        req.user?.id || 'SYSTEM',
        schoolId
      );
    }

    res.json({
      success: true,
      entriesProcessed: results.length,
      totalScore: processedEntries[0]?.totalScore || 0,
      components: components.map((c: any) => ({
        id: c.id,
        name: c.name,
        weight: c.weight,
      })),
    });
  } catch (error: any) {
    console.error('Error entering flexible results:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to enter results'
    });
  }
});

// GET /api/admin/flexible-results/:assessmentId
// Get all results for an assessment
router.get('/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId) {
      return res.status(400).json({ error: 'Missing school ID' });
    }

    // Verify assessment belongs to school
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        results: {
          include: { pupil: true },
        },
        term: true,
      },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Sort results by pupil name
    assessment.results.sort((a: any, b: any) => 
      (a.pupil?.name || '').localeCompare(b.pupil?.name || '')
    );

    // Get components
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        // Empty components
      }
    }

    // Format results with component breakdown
    const formattedResults = assessment.results.map((result: any) => ({
      id: result.id,
      pupilId: result.pupilId,
      pupilName: `${result.pupil?.firstName} ${result.pupil?.lastName}`.trim(),
      subject: result.subject,
      totalScore: result.totalScore,
      comment: result.comment,
      // For now, display legacy CA/Test/Exam fields
      caScore: result.caScore,
      testScore: result.testScore,
      examScore: result.examScore,
    }));

    res.json({
      assessmentId,
      assessment: {
        id: assessment.id,
        name: assessment.name,
        status: assessment.status,
        term: assessment.term?.name,
      },
      components: components.sort((a: any, b: any) => 
        (a.sortOrder || 0) - (b.sortOrder || 0)
      ),
      results: formattedResults,
      stats: {
        totalEntries: formattedResults.length,
        averageScore: formattedResults.length > 0
          ? Math.round(
              formattedResults.reduce((sum: number, r: any) => sum + (r.totalScore || 0), 0) 
              / formattedResults.length * 100
            ) / 100
          : 0,
        highestScore: formattedResults.length > 0
          ? Math.max(...formattedResults.map((r: any) => r.totalScore || 0))
          : 0,
        lowestScore: formattedResults.length > 0
          ? Math.min(...formattedResults.map((r: any) => r.totalScore || 0))
          : 0,
      },
    });
  } catch (error) {
    console.error('Error fetching flexible results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// PUT /api/admin/flexible-results/:resultId
// Update a single result
router.put('/:resultId', async (req: Request, res: Response) => {
  try {
    const { resultId } = req.params;
    const { assessmentId, scores, comment } = req.body;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !assessmentId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get assessment to verify ownership and get components
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft' });
    }

    // Get components
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        return res.status(400).json({ error: 'Invalid assessment components' });
      }
    }

    // Calculate new total
    let totalScore = 0;
    for (const component of components) {
      const componentScore = scores?.[component.id];
      if (componentScore !== undefined && componentScore !== null) {
        const score = parseFloat(componentScore);
        if (!isNaN(score)) {
          const componentPercentage = (score / component.maxScore) * 100;
          const weightedScore = (componentPercentage * component.weight) / 100;
          totalScore += weightedScore;
        }
      }
    }
    totalScore = Math.round(totalScore * 100) / 100;

    // Update result
    const updated = await prisma.result.update({
      where: { id: resultId },
      data: {
        totalScore,
        comment: comment || '',
      },
      include: { pupil: true, assessment: true },
    });

    res.json({
      success: true,
      result: {
        id: updated.id,
        pupilName: `${updated.pupil?.firstName} ${updated.pupil?.lastName}`.trim(),
        totalScore: updated.totalScore,
        comment: updated.comment,
      },
    });
  } catch (error) {
    console.error('Error updating result:', error);
    res.status(500).json({ error: 'Failed to update result' });
  }
});

// POST /api/admin/flexible-results/:assessmentId/finalize
// Finalize scores (prevent further edits until returned to draft)
router.post('/:assessmentId/finalize', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId) {
      return res.status(400).json({ error: 'Missing school ID' });
    }

    // Verify assessment
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
      include: { _count: { select: { results: true } } },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    if (assessment._count.results === 0) {
      return res.status(400).json({ error: 'Cannot finalize assessment with no results' });
    }

    // Update status to READY_FOR_APPROVAL
    const updated = await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        status: 'APPROVED', // Simplified workflow for now
      },
      include: { _count: { select: { results: true } } },
    });

    res.json({
      success: true,
      assessment: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        resultCount: updated._count.results,
      },
    });
  } catch (error) {
    console.error('Error finalizing results:', error);
    res.status(500).json({ error: 'Failed to finalize results' });
  }
});

export default router;
