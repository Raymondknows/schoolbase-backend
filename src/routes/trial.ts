import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// POST /api/trial/start - Start trial for a school
router.post('/start', async (req: Request, res: Response) => {
  try {
    const { schoolId, days = 30 } = req.body;

    if (!schoolId) {
      return res.status(400).json({ error: 'Missing schoolId' });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + days);

    // Update school with trial end date
    const school = await prisma.school.update({
      where: { id: schoolId },
      data: {
        trialEndsAt,
        status: 'TRIAL',
      },
      select: {
        id: true,
        name: true,
        trialEndsAt: true,
        status: true,
      },
    });

    res.json({
      success: true,
      message: `Trial started for ${days} days`,
      school,
    });
  } catch (error: any) {
    console.error('Error starting trial:', error);
    res.status(500).json({
      error: 'Failed to start trial',
      details: error.message,
    });
  }
});

export default router;
