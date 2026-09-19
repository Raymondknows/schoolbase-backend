import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { jwtVerify } from 'jose';
import { getSessionSecret } from '../services/security-config.js';
import { resolveSchoolScope } from '../services/security-context.js';

const router = Router();
const prisma = new PrismaClient();

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
      console.error('[assessment-setup] Failed to resolve schoolId from token', error);
    }
  }

  const scope = resolveSchoolScope({ authenticatedSchoolId, authenticatedRole, requestedSchoolId });
  if (scope.rejected) {
    console.warn('[assessment-setup] Rejected cross-school scope request');
    return null;
  }

  return scope.schoolId;
}

/**
 * Assessment Setup Routes - Quick Wizard for CA/Test/Exam Configuration
 * 
 * Allows admins to quickly define the assessment structure:
 * - CA (Continuous Assessment) weight
 * - Test (Mid-term) weight
 * - Exam (Final) weight
 * Total must equal 100%
 */

// GET /api/assessments/:id/setup
// Get current assessment setup configuration
router.get('/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(403).json({ error: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope verification failed' });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: { term: true },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Parse existing components
    let components = null;
    let isConfigured = false;

    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || null;
        isConfigured = !!components && components.length > 0;
      } catch (e) {
        // Parsing failed
      }
    }

    res.json({
      assessmentId,
      assessmentName: assessment.name,
      status: assessment.status,
      isConfigured,
      components,
      message: !isConfigured 
        ? 'Assessment structure not defined. Please configure CA/Test/Exam weights.' 
        : 'Assessment is configured and ready.',
    });
  } catch (error) {
    console.error('Error fetching assessment setup:', error);
    res.status(500).json({ error: 'Failed to fetch setup' });
  }
});

// GET /api/assessments/:id/setup/default
// Get default configuration (CA 20% / Test 20% / Exam 60%)
router.get('/:assessmentId/default', async (req: Request, res: Response) => {
  try {
    const defaultComponents = [
      {
        id: 'comp-ca',
        name: 'Continuous Assessment',
        maxScore: 20,
        weight: 20,
        sortOrder: 1,
      },
      {
        id: 'comp-test',
        name: 'Test',
        maxScore: 20,
        weight: 20,
        sortOrder: 2,
      },
      {
        id: 'comp-exam',
        name: 'Examination',
        maxScore: 60,
        weight: 60,
        sortOrder: 3,
      },
    ];

    const totalWeight = defaultComponents.reduce((sum, c) => sum + c.weight, 0);

    res.json({
      components: defaultComponents,
      totalWeight,
      message: 'Default assessment structure (CA 20%, Test 20%, Exam 60%)',
    });
  } catch (error) {
    console.error('Error fetching default setup:', error);
    res.status(500).json({ error: 'Failed to fetch default setup' });
  }
});

// POST /api/assessments/:id/setup
// Save assessment configuration (wizard completion)
router.post('/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const { components } = req.body;
    const schoolId = await resolveSchoolId(req);
    const userId = req.headers['x-user-id'] as string;

    if (!schoolId) {
      return res.status(403).json({ error: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope verification failed' });
    }

    if (!Array.isArray(components) || components.length === 0) {
      return res.status(400).json({ error: 'Components array required' });
    }

    // Verify assessment belongs to school and is in DRAFT
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft status' });
    }

    // Validate each component
    for (const comp of components) {
      if (!comp.name || comp.maxScore === undefined || comp.weight === undefined) {
        return res.status(400).json({
          error: 'Each component must have: name, maxScore, weight',
        });
      }

      if (comp.weight < 0 || comp.weight > 100) {
        return res.status(400).json({
          error: `Component weight must be between 0 and 100: ${comp.name}`,
        });
      }

      if (comp.maxScore <= 0) {
        return res.status(400).json({
          error: `Component max score must be greater than 0: ${comp.name}`,
        });
      }
    }

    // Validate total weight
    const totalWeight = components.reduce((sum: number, c: any) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      return res.status(400).json({
        error: `Total weight must equal 100% (current: ${totalWeight}%)`,
      });
    }

    // Normalize components
    const normalizedComponents = components.map((c: any, idx: number) => ({
      id: c.id || `comp-${idx}-${Date.now()}`,
      name: c.name,
      maxScore: parseFloat(c.maxScore as any),
      weight: parseFloat(c.weight as any),
      sortOrder: c.sortOrder || idx + 1,
    }));

    // Save to assessment
    const updated = await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify({ components: normalizedComponents }),
      },
      include: { term: true, _count: { select: { results: true } } },
    });

    res.json({
      success: true,
      message: 'Assessment structure configured successfully',
      assessment: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        componentsCount: normalizedComponents.length,
        totalWeight,
      },
      components: normalizedComponents,
    });
  } catch (error) {
    console.error('Error saving assessment setup:', error);
    res.status(500).json({ error: 'Failed to save setup' });
  }
});

// PATCH /api/assessments/:id/setup
// Update partial configuration
router.patch('/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const { components } = req.body;
    const schoolId = await resolveSchoolId(req);

    if (!schoolId) {
      return res.status(403).json({ error: 'SCHOOL_SCOPE_REQUIRED', message: 'School scope verification failed' });
    }

    if (!Array.isArray(components)) {
      return res.status(400).json({ error: 'Components array required' });
    }

    // Verify assessment belongs to school and is in DRAFT
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft' });
    }

    // Validate total weight
    const totalWeight = components.reduce((sum: number, c: any) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      return res.status(400).json({
        error: `Total weight must equal 100% (current: ${totalWeight}%)`,
      });
    }

    // Update
    const updated = await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify({ components }),
      },
    });

    res.json({
      success: true,
      message: 'Assessment structure updated',
      components,
      totalWeight,
    });
  } catch (error) {
    console.error('Error updating assessment setup:', error);
    res.status(500).json({ error: 'Failed to update setup' });
  }
});

export default router;
