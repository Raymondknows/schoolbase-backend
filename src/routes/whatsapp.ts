import { Router, Request, Response } from 'express';

const router = Router();

// POST /api/whatsapp/retry - Retry failed WhatsApp message
router.post('/retry', async (req: Request, res: Response) => {
  try {
    const { messageId, phoneNumber, message } = req.body;

    if (!messageId || !phoneNumber || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // In a real implementation, this would retry sending the message via WhatsApp Cloud API
    res.json({
      success: true,
      message: 'Message retry initiated',
      messageId,
      status: 'pending',
    });
  } catch (error: any) {
    console.error('Error retrying WhatsApp message:', error);
    res.status(500).json({
      error: 'Failed to retry message',
      details: error.message,
    });
  }
});

export default router;
