// @ts-nocheck
// @ts-nocheck
import { Router, Request, Response } from 'express';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { sendPaymentSuccessEmail } from '../jobs/subscriptionEmails.js';

const router = Router();
const prisma = new PrismaClient();

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// POST /api/paystack/init - Initialize Paystack payment
router.post('/init', async (req: Request, res: Response) => {
  try {
    const { email, amount, amountMinor, metadata, callback_url, cancel_action } = req.body;

    const normalizedAmount = typeof amount === 'number' ? amount : typeof amountMinor === 'number' ? amountMinor / 100 : null;
    const normalizedCallbackUrl = typeof callback_url === 'string' && callback_url.trim() ? callback_url.trim() : undefined;
    const normalizedCancelAction = typeof cancel_action === 'string' && cancel_action.trim()
      ? cancel_action.trim()
      : normalizedCallbackUrl || normalizedCallbackUrl;

    if (!email || normalizedAmount === null) {
      return res.status(400).json({ error: 'Missing required fields: email and amountMinor/amount' });
    }

    const reference = `TXN-${Date.now()}-${crypto.randomUUID()}`;

    // Build metadata for Paystack while preserving the original values for verification.
    const paystackMetadata = {
      plan: metadata?.plan || '',
      schoolName: metadata?.schoolName || '',
      schoolSlug: metadata?.schoolSlug || metadata?.slug || '',
      name: metadata?.name || '',
      phone: metadata?.phone || '',
      amountMinor: normalizedAmount * 100,
      custom_fields: [
        { display_name: 'Plan', variable_name: 'plan', value: metadata?.plan || '' },
        { display_name: 'School Name', variable_name: 'school_name', value: metadata?.schoolName || '' },
        { display_name: 'Contact Name', variable_name: 'contact_name', value: metadata?.name || '' },
        { display_name: 'Contact Phone', variable_name: 'contact_phone', value: metadata?.phone || '' },
      ],
    };

    const school = metadata?.schoolSlug || metadata?.slug || metadata?.schoolName
      ? await prisma.school.findFirst({
          where: metadata?.schoolSlug || metadata?.slug
            ? { slug: String(metadata.schoolSlug || metadata.slug) }
            : { name: String(metadata.schoolName) },
          select: { id: true, name: true, slug: true },
        })
      : null;

    const existingPlatformPayment = await prisma.platformPayment.findFirst({
      where: { reference },
      select: { id: true },
    });

    if (!existingPlatformPayment) {
      await prisma.platformPayment.create({
        data: {
          amount: Math.round(normalizedAmount * 100),
          method: 'CARD',
          reference,
          recordedBy: school?.id || null,
          note: JSON.stringify({
            schoolId: school?.id || null,
            schoolName: school?.name || metadata?.schoolName || '',
            schoolSlug: school?.slug || metadata?.schoolSlug || metadata?.slug || '',
            plan: metadata?.plan || '',
            status: 'PENDING',
            paymentStatus: 'PENDING',
            source: 'paystack-init',
          }),
        },
      });
    }

    // Initialize transaction with Paystack
    const response = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      {
        email,
        amount: Math.round(normalizedAmount * 100), // Convert to kobo (smallest unit)
        reference,
        metadata: paystackMetadata,
        callback_url: normalizedCallbackUrl,
        cancel_action: normalizedCancelAction,
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

    const existingPlatformPayment = await prisma.platformPayment.findFirst({
      where: { reference: transaction.reference },
      select: { id: true, note: true },
    });

    if (existingPlatformPayment) {
      await prisma.platformPayment.update({
        where: { id: existingPlatformPayment.id },
        data: {
          amount: amountMinor,
          method: 'CARD',
          recordedBy: school.id,
          note: JSON.stringify({
            schoolId: school.id,
            schoolName: updatedSchool.name,
            schoolSlug: updatedSchool.slug,
            plan: nextPlan,
            status: 'ACTIVE',
            paymentStatus: 'COMPLETED',
            source: 'paystack-verify',
          }),
        },
      });
    } else {
      await prisma.platformPayment.create({
        data: {
          amount: amountMinor,
          method: 'CARD',
          reference: transaction.reference,
          recordedBy: school.id,
          note: JSON.stringify({
            schoolId: school.id,
            schoolName: updatedSchool.name,
            schoolSlug: updatedSchool.slug,
            plan: nextPlan,
            status: 'ACTIVE',
            paymentStatus: 'COMPLETED',
            source: 'paystack-verify',
          }),
        },
      });
    }

    // Send payment success email
    try {
      const admin = await prisma.user.findFirst({
        where: {
          schoolId: school.id,
          role: 'SCHOOL_ADMIN',
        },
        select: { email: true, name: true },
      });

      if (admin?.email) {
        const amountFormatted = (amountMinor / 100).toLocaleString('en-NG', {
          style: 'currency',
          currency: 'NGN',
          minimumFractionDigits: 2,
        });

        const expiryDate = subscriptionExpiresAt.toLocaleDateString('en-NG', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        await sendPaymentSuccessEmail(
          admin.email,
          updatedSchool.name,
          admin.name,
          nextPlan,
          amountFormatted,
          expiryDate
        );
      }
    } catch (emailError) {
      console.error('Error sending payment success email:', emailError);
      // Don't fail the subscription verification if email fails
    }

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
