import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * Assessment Components Routes - v2 Results System
 * 
 * Supports flexible assessment scoring:
 * - CA1, CA2, CA3 (Continuous Assessment)
 * - Test (Mid-term test)
 * - Exam (Final examination)
 * - Assignment, Project, Practical, Quiz
 * 
 * Each component has: name, maxScore, weight (%), sortOrder
 */

// GET /api/admin/assessment-components/:assessmentId
// Fetch all components for an assessment
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
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Parse components from assessment data if stored as JSON
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        // If parsing fails, return empty array
      }
    }

    res.json({
      assessmentId,
      components,
      totalWeight: components.reduce((sum: number, c: any) => sum + (c.weight || 0), 0),
    });
  } catch (error) {
    console.error('Error fetching assessment components:', error);
    res.status(500).json({ error: 'Failed to fetch components' });
  }
});

// POST /api/admin/assessment-components/:assessmentId
// Create new component for assessment
router.post('/:assessmentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const { name, maxScore, weight, sortOrder } = req.body;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !name || maxScore === undefined || weight === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, maxScore, weight' 
      });
    }

    // Verify assessment belongs to school and is in DRAFT
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft' });
    }

    if (weight < 0 || weight > 100) {
      return res.status(400).json({ error: 'Weight must be between 0 and 100' });
    }

    if (maxScore <= 0) {
      return res.status(400).json({ error: 'Max score must be greater than 0' });
    }

    // Parse existing components
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        // Start fresh if parsing fails
      }
    }

    // Create new component
    const newComponent = {
      id: `comp-${Date.now()}`,
      name,
      maxScore: parseFloat(maxScore as any),
      weight: parseFloat(weight as any),
      sortOrder: sortOrder || components.length + 1,
      createdAt: new Date().toISOString(),
    };

    components.push(newComponent);

    // Validate total weight doesn't exceed 100%
    const totalWeight = components.reduce((sum: number, c: any) => sum + c.weight, 0);
    if (totalWeight > 100) {
      return res.status(400).json({ 
        error: `Total weight would exceed 100% (current: ${totalWeight}%)` 
      });
    }

    // Update assessment with new components
    const updated = await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify({ components }),
      },
      include: { term: true, _count: { select: { results: true } } },
    });

    res.status(201).json({
      component: newComponent,
      assessment: updated,
    });
  } catch (error) {
    console.error('Error creating component:', error);
    res.status(500).json({ error: 'Failed to create component' });
  }
});

// PUT /api/admin/assessment-components/:assessmentId/:componentId
// Update a specific component
router.put('/:assessmentId/:componentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId, componentId } = req.params;
    const { name, maxScore, weight, sortOrder } = req.body;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId) {
      return res.status(400).json({ error: 'Missing school ID' });
    }

    // Verify assessment belongs to school and is in DRAFT
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft' });
    }

    // Parse components
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        return res.status(400).json({ error: 'Invalid component data' });
      }
    }

    // Find and update component
    const componentIndex = components.findIndex((c: any) => c.id === componentId);
    if (componentIndex === -1) {
      return res.status(404).json({ error: 'Component not found' });
    }

    const oldComponent = components[componentIndex];
    const updatedComponent = {
      ...oldComponent,
      name: name || oldComponent.name,
      maxScore: maxScore !== undefined ? parseFloat(maxScore) : oldComponent.maxScore,
      weight: weight !== undefined ? parseFloat(weight) : oldComponent.weight,
      sortOrder: sortOrder !== undefined ? sortOrder : oldComponent.sortOrder,
      updatedAt: new Date().toISOString(),
    };

    // Validate weight
    if (updatedComponent.weight < 0 || updatedComponent.weight > 100) {
      return res.status(400).json({ error: 'Weight must be between 0 and 100' });
    }

    // Validate max score
    if (updatedComponent.maxScore <= 0) {
      return res.status(400).json({ error: 'Max score must be greater than 0' });
    }

    // Update in array
    components[componentIndex] = updatedComponent;

    // Validate total weight
    const totalWeight = components.reduce((sum: number, c: any) => sum + c.weight, 0);
    if (totalWeight > 100) {
      return res.status(400).json({ 
        error: `Total weight would exceed 100% (current: ${totalWeight}%)` 
      });
    }

    // Save back to assessment
    const updated = await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify({ components }),
      },
    });

    res.json({
      component: updatedComponent,
      totalWeight,
    });
  } catch (error) {
    console.error('Error updating component:', error);
    res.status(500).json({ error: 'Failed to update component' });
  }
});

// DELETE /api/admin/assessment-components/:assessmentId/:componentId
// Delete a component (only if no scores entered yet)
router.delete('/:assessmentId/:componentId', async (req: Request, res: Response) => {
  try {
    const { assessmentId, componentId } = req.params;
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId) {
      return res.status(400).json({ error: 'Missing school ID' });
    }

    // Verify assessment belongs to school and is in DRAFT
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found or not in draft' });
    }

    // Parse components
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        return res.status(400).json({ error: 'Invalid component data' });
      }
    }

    // Find and remove component
    const initialLength = components.length;
    components = components.filter((c: any) => c.id !== componentId);

    if (components.length === initialLength) {
      return res.status(404).json({ error: 'Component not found' });
    }

    // Update assessment
    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify({ components }),
      },
    });

    res.json({ 
      success: true, 
      message: 'Component deleted',
      remainingComponents: components.length,
    });
  } catch (error) {
    console.error('Error deleting component:', error);
    res.status(500).json({ error: 'Failed to delete component' });
  }
});

// POST /api/admin/assessment-components/:assessmentId/reorder
// Reorder components by dragging
router.post('/:assessmentId/reorder', async (req: Request, res: Response) => {
  try {
    const { assessmentId } = req.params;
    const { componentOrder } = req.body; // Array of component IDs in new order
    const schoolId = req.headers['x-school-id'] as string;

    if (!schoolId || !Array.isArray(componentOrder)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Verify assessment belongs to school
    const assessment = await prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId, status: 'DRAFT' },
    });

    if (!assessment) {
      return res.status(404).json({ error: 'Assessment not found' });
    }

    // Parse components
    let components = [];
    if (assessment.componentData && typeof assessment.componentData === 'string') {
      try {
        const data = JSON.parse(assessment.componentData);
        components = data.components || [];
      } catch (e) {
        return res.status(400).json({ error: 'Invalid component data' });
      }
    }

    // Reorder based on provided IDs
    const reorderedComponents = componentOrder
      .map((id: string) => components.find((c: any) => c.id === id))
      .filter(Boolean)
      .map((c: any, idx: number) => ({ ...c, sortOrder: idx + 1 }));

    if (reorderedComponents.length !== components.length) {
      return res.status(400).json({ error: 'Invalid component IDs' });
    }

    // Save reordered components
    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify({ components: reorderedComponents }),
      },
    });

    res.json({
      success: true,
      components: reorderedComponents,
    });
  } catch (error) {
    console.error('Error reordering components:', error);
    res.status(500).json({ error: 'Failed to reorder components' });
  }
});

export default router;
