import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/videos', async (_req: Request, res: Response) => {
  try {
    const videos = await prisma.videoTutorial.findMany({
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      videos: videos.map((video) => ({
        id: video.id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        category: video.category,
        featured: video.featured,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching public videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

router.get('/videos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const video = await prisma.videoTutorial.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({
      video: {
        id: video.id,
        title: video.title,
        description: video.description,
        videoUrl: video.videoUrl,
        category: video.category,
        featured: video.featured,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching public video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

export default router;
