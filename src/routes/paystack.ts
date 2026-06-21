import { Router, Request, Response } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// POST /api/paystack/init - Initialize Paystack payment
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { email, amount, amountMinor, metadata, callback_url } = req.body;

    const normalizedAmount = typeof amount === 'number' ? amount : typeof amountMinor === 'number' ? amountMinor / 100 : null;

    if (!email || normalizedAmount === null) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Initialize transaction with Paystack
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email,
        amount: Math.round(normalizedAmount * 100), // Convert to kobo (smallest unit)
        reference: `TXN-${Date.now()}-${crypto.randomUUID()}`,
        metadata,
        callback_url,
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
    console.error('Error initializing Paystack payment:', {
      message: error.message,
      responseData: error.response?.data,
      requestBody: req.body,
    });
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      error: 'Failed to initialize payment',
      details: error.response?.data || error.message,
    });
  }
});

// POST /api/paystack/verify-subscription - Verify and activate a subscription payment
router.post('/verify-subscription', async (req: Request, res: Response) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({ error: 'Missing reference' });
    }

    const verifyResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const transaction = verifyResponse.data?.data;
    const metadata = transaction?.metadata || {};
    const schoolSlug = String(metadata.schoolSlug || metadata.school_slug || '').trim();
    const schoolName = String(metadata.schoolName || metadata.school_name || '').trim();
    const planLabel = String(metadata.plan || '').trim().toUpperCase();
    const amountMinor = Number(metadata.amountMinor || metadata.amount_minor || transaction?.amount || 0);

    if (!transaction || transaction.status !== 'success') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const school = await prisma.school.findFirst({
      where: schoolSlug ? { slug: schoolSlug } : schoolName ? { name: schoolName } : undefined,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true,
        subscriptionExpiresAt: true,
      },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found for subscription verification' });
    }

    const planMap: Record<string, 'STARTER' | 'GROWTH' | 'ENTERPRISE'> = {
      STARTER: 'STARTER',
      STANDARD: 'GROWTH',
      GROWTH: 'GROWTH',
      ENTERPRISE: 'ENTERPRISE',
    };

    const nextPlan = planMap[planLabel] || school.plan || 'STARTER';
    const subscriptionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const updatedSchool = await prisma.school.update({
      where: { id: school.id },
      data: {
        status: 'ACTIVE',
        plan: nextPlan,
        subscriptionExpiresAt,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        plan: true,
        subscriptionExpiresAt: true,
      },
    });

    res.json({
      success: true,
      school: updatedSchool,
      transaction: {
        reference: transaction.reference,
        amount: amountMinor,
        currency: transaction.currency,
      },
    });
  } catch (error: any) {
    console.error('Error verifying subscription payment:', error);
    res.status(500).json({
      error: 'Failed to verify subscription payment',
      details: error.response?.data || error.message,
    });
  }
});

export default router;
