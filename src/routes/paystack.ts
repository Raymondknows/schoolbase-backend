import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// POST /api/paystack/init - Initialize Paystack payment
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { email, amount, reference, metadata } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Initialize transaction with Paystack
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email,
        amount: Math.round(amount * 100), // Convert to kobo (smallest unit)
        reference: reference || `TXN-${Date.now()}`,
        metadata,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json(response.data);
  } catch (error: any) {
    console.error('Error initializing Paystack payment:', error);
    res.status(500).json({
      error: 'Failed to initialize payment',
      details: error.response?.data || error.message,
    });
  }
});

export default router;
