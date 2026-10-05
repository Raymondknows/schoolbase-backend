import { Router, type Request, type Response, type NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyAuth, type AuthenticatedRequest } from '../middleware/roleAuth.js';
import { requireSubscription } from '../middleware/subscriptionGuard.js';
import { calculateIdCardQuote, ID_CARD_TEMPLATES, validateIdCardPricingRule, type IdCardPricingRule } from '../services/id-card-pricing.js';
import { decryptIdCardSnapshot, encryptIdCardSnapshot } from '../services/id-card-snapshot.js';
import { generateIdCardPdf, savePrivateIdCardArtifact, type IdCardRenderSnapshot } from '../services/id-card-pdf.js';

const router = Router();
const prisma = new PrismaClient();
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const MAX_ORDER_CARDS = 200;

function authenticatedUser(req: Request) {
  return (req as AuthenticatedRequest).user;
}

function requireSchoolAdmin(req: Request, res: Response, next: NextFunction) {
  const user = authenticatedUser(req);
  if (!user?.schoolId || !user.userId) return res.status(401).json({ error: 'School session required.' });
  if (user.role !== 'SCHOOL_ADMIN') return res.status(403).json({ error: 'School administrator access required.' });
  next();
}

async function getActivePricingRule() {
  const row = await prisma.idCardPricingRule.findFirst({
    where: { isActive: true, effectiveAt: { lte: new Date() } },
    orderBy: { effectiveAt: 'desc' },
  });
  if (!row) return null;
  try {
    const rule: unknown = JSON.parse(row.ruleJson);
    return validateIdCardPricingRule(rule) ? { row, rule } : null;
  } catch {
    return null;
  }
}

function addOrderEvent(tx: any, orderId: string, eventType: string, actorId: string | null, details?: Record<string, unknown>) {
  return tx.idCardOrderEvent.create({
    data: { orderId, eventType, actorId, details: details ? JSON.stringify(details) : null },
  });
}

router.use(verifyAuth, requireSchoolAdmin);

router.get('/templates', (_req, res) => {
  res.json({
    templates: Object.entries(ID_CARD_TEMPLATES).map(([id, template]) => ({ id, ...template })),
    parentPortalQr: { available: false, reason: 'Parent Portal authentication security review is required before QR activation.' },
  });
});

router.get('/students', requireSubscription, async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const search = String(req.query.search || '').trim();
  const classId = typeof req.query.classId === 'string' ? req.query.classId : undefined;
  const where: any = { schoolId: user.schoolId, isActive: true };
  if (classId) where.classId = classId;
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { middleName: { contains: search } },
      { lastName: { contains: search } },
      { admissionNo: { contains: search } },
    ];
  }

  try {
    const [students, total, classes] = await Promise.all([
      prisma.pupil.findMany({
        where,
        take: 500,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          admissionNo: true,
          photoUrl: true,
          classId: true,
          class: { select: { name: true, arm: true } },
        },
      }),
      prisma.pupil.count({ where }),
      prisma.class.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' }, select: { id: true, name: true, arm: true } }),
    ]);
    res.json({ students, total, classes, capped: total > students.length });
  } catch (error) {
    console.error('[id-card-studio] Failed to load students', error);
    res.status(500).json({ error: 'Unable to load student records.' });
  }
});

router.post('/quotes', requireSubscription, async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const rawIds = req.body?.studentIds;
  const templateId = String(req.body?.templateId || '');
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > MAX_ORDER_CARDS || rawIds.some((id: unknown) => typeof id !== 'string')) {
    return res.status(400).json({ error: `Choose between 1 and ${MAX_ORDER_CARDS} students.` });
  }
  const studentIds = rawIds.map((id: string) => id.trim());
  if (new Set(studentIds).size !== studentIds.length) return res.status(400).json({ error: 'The selection contains duplicate students.' });

  try {
    const pricing = await getActivePricingRule();
    if (!pricing) return res.status(503).json({ error: 'ID-card pricing is not configured.' });
    const [students, school] = await Promise.all([
      prisma.pupil.findMany({
        where: { id: { in: studentIds }, schoolId: user.schoolId, isActive: true },
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          admissionNo: true,
          photoUrl: true,
          class: { select: { name: true, arm: true } },
        },
      }),
      prisma.school.findUnique({
        where: { id: user.schoolId },
        select: { id: true, name: true, slug: true, initials: true, logoUrl: true, primaryColor: true, address: true, phone: true, currency: true },
      }),
    ]);
    if (!school || students.length !== studentIds.length) return res.status(400).json({ error: 'One or more selected students are unavailable.' });

    const quote = calculateIdCardQuote({ quantity: students.length, templateId, rule: pricing.rule });
    const snapshot: IdCardRenderSnapshot = {
      templateId,
      school: {
        name: school.name,
        slug: school.slug,
        initials: school.initials,
        logoUrl: school.logoUrl,
        primaryColor: school.primaryColor,
        address: school.address,
        phone: school.phone,
      },
      students: students.map((student) => ({
        id: student.id,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        admissionNo: student.admissionNo,
        photoUrl: student.photoUrl,
        className: [student.class?.name, student.class?.arm].filter(Boolean).join(' ') || null,
      })),
    };
    const saved = await prisma.idCardQuote.create({
      data: {
        schoolId: user.schoolId,
        pricingRuleId: pricing.row.id,
        pricingRuleVersion: pricing.row.version,
        currency: quote.currency,
        quantity: quote.quantity,
        templateId: quote.templateId,
        templateTier: quote.templateTier,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        studentIdsJson: JSON.stringify(studentIds),
        optionsJson: JSON.stringify({ bandBreakdown: quote.bandBreakdown, upliftPerCardMinor: quote.upliftPerCardMinor }),
        renderSnapshotEncrypted: encryptIdCardSnapshot(snapshot),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdBy: user.userId,
      },
    });
    res.status(201).json({
      quote: {
        id: saved.id,
        quantity: quote.quantity,
        currency: quote.currency,
        templateId: quote.templateId,
        templateTier: quote.templateTier,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        taxMinor: quote.taxMinor,
        totalMinor: quote.totalMinor,
        bandBreakdown: quote.bandBreakdown,
        upliftPerCardMinor: quote.upliftPerCardMinor,
        expiresAt: saved.expiresAt,
      },
      preview: snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create quote.';
    res.status(400).json({ error: message });
  }
});

router.post('/orders', requireSubscription, async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const quoteId = String(req.body?.quoteId || '');
  if (!quoteId) return res.status(400).json({ error: 'Quote is required.' });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const quote = await tx.idCardQuote.findFirst({ where: { id: quoteId, schoolId: user.schoolId } });
      if (!quote || quote.status !== 'QUOTED' || quote.expiresAt <= new Date()) throw new Error('This quote has expired. Create a new quote.');
      const order = await tx.idCardOrder.create({
        data: {
          schoolId: user.schoolId,
          quoteId: quote.id,
          currency: quote.currency,
          amountMinor: quote.totalMinor,
          renderSnapshotEncrypted: quote.renderSnapshotEncrypted,
        },
      });
      await tx.idCardQuote.update({ where: { id: quote.id }, data: { status: 'ORDERED' } });
      await addOrderEvent(tx, order.id, 'ORDER_CREATED', user.userId, { quantity: quote.quantity, amountMinor: quote.totalMinor, currency: quote.currency });
      return order;
    });
    res.status(201).json({ order: { id: result.id, status: result.status, paymentStatus: result.paymentStatus, amountMinor: result.amountMinor, currency: result.currency } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create order.';
    res.status(400).json({ error: message });
  }
});

router.post('/orders/:orderId/pay', requireSubscription, async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(503).json({ error: 'Card-order payments are not configured.' });

  const order = await prisma.idCardOrder.findFirst({ where: { id: req.params.orderId, schoolId: user.schoolId }, include: { quote: true } });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.paymentStatus === 'PAID') return res.status(409).json({ error: 'This order has already been paid.' });
  if (order.providerReference) return res.status(409).json({ error: 'Payment has already been initialized for this order.' });
  if (!user.email) return res.status(400).json({ error: 'A school administrator email is required for payment.' });

  const reference = `IDCARD-${randomUUID()}`;
  const reserved = await prisma.idCardOrder.updateMany({
    where: { id: order.id, schoolId: user.schoolId, providerReference: null, paymentStatus: 'PENDING' },
    data: { providerReference: reference },
  });
  if (reserved.count !== 1) return res.status(409).json({ error: 'Payment is already being initialized.' });

  try {
    const response = await axios.post(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      email: user.email,
      amount: order.amountMinor,
      reference,
      currency: order.currency,
      callback_url: `${String(req.headers.origin || process.env.FRONTEND_URL || '').replace(/\/$/, '')}/admin/id-cards/orders/${order.id}`,
      metadata: { orderType: 'ID_CARD', orderId: order.id, schoolId: order.schoolId },
    }, { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } });
    await prisma.idCardOrderEvent.create({ data: { orderId: order.id, eventType: 'CHECKOUT_INITIALIZED', actorId: user.userId, details: JSON.stringify({ provider: 'PAYSTACK' }) } });
    return res.json({ authorizationUrl: response.data?.data?.authorization_url, accessCode: response.data?.data?.access_code, reference });
  } catch (error) {
    await prisma.idCardOrder.updateMany({ where: { id: order.id, providerReference: reference }, data: { providerReference: null } });
    console.error('[id-card-studio] Payment initialization failed', error);
    return res.status(502).json({ error: 'Unable to initialize payment. Please retry.' });
  }
});

router.get('/orders/:orderId', async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const order = await prisma.idCardOrder.findFirst({
    where: { id: req.params.orderId, schoolId: user.schoolId },
    include: { quote: { select: { quantity: true, templateId: true, templateTier: true, expiresAt: true } } },
  });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({
    order: {
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      amountMinor: order.amountMinor,
      currency: order.currency,
      createdAt: order.createdAt,
      quantity: order.quote.quantity,
      templateId: order.quote.templateId,
      templateTier: order.quote.templateTier,
    },
  });
});

async function verifyAndGenerate(orderId: string, schoolId: string, actorId: string | null) {
  const order = await prisma.idCardOrder.findFirst({ where: { id: orderId, schoolId }, include: { quote: true } });
  if (!order) throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
  if (order.paymentStatus === 'PAID' && order.status === 'READY') return order;
  if (order.paymentStatus !== 'PAID') {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret || !order.providerReference) throw Object.assign(new Error('Payment is not available for this order.'), { statusCode: 400 });
    const response = await axios.get(`${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(order.providerReference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const transaction = response.data?.data;
    const metadata = transaction?.metadata || {};
    if (transaction?.status !== 'success' || Number(transaction.amount) !== order.amountMinor || String(transaction.currency).toUpperCase() !== order.currency.toUpperCase() || transaction.reference !== order.providerReference || metadata.orderId !== order.id || metadata.schoolId !== schoolId || metadata.orderType !== 'ID_CARD') {
      throw Object.assign(new Error('Payment could not be verified for this order.'), { statusCode: 400 });
    }
    await prisma.$transaction(async (tx) => {
      const updated = await tx.idCardOrder.updateMany({ where: { id: order.id, paymentStatus: 'PENDING' }, data: { paymentStatus: 'PAID', status: 'PAID', providerTransactionId: String(transaction.id) } });
      if (updated.count === 1) await addOrderEvent(tx, order.id, 'PAYMENT_CONFIRMED', actorId, { currency: order.currency, amountMinor: order.amountMinor });
    });
  }

  const paidOrder = await prisma.idCardOrder.findFirst({ where: { id: order.id, schoolId }, include: { quote: true } });
  if (!paidOrder || paidOrder.paymentStatus !== 'PAID') throw Object.assign(new Error('Payment is not confirmed.'), { statusCode: 409 });
  const claimed = await prisma.idCardOrder.updateMany({ where: { id: paidOrder.id, status: { in: ['PAID', 'GENERATION_FAILED'] } }, data: { status: 'GENERATING' } });
  if (claimed.count === 0) return prisma.idCardOrder.findUniqueOrThrow({ where: { id: paidOrder.id } });

  await prisma.idCardOrderEvent.create({ data: { orderId: paidOrder.id, eventType: 'GENERATION_STARTED', actorId } });
  try {
    if (!paidOrder.renderSnapshotEncrypted) throw new Error('The approved render snapshot is unavailable.');
    const snapshot = decryptIdCardSnapshot<IdCardRenderSnapshot>(paidOrder.renderSnapshotEncrypted);
    const bytes = await generateIdCardPdf(snapshot);
    const artifactPath = await savePrivateIdCardArtifact(paidOrder.id, bytes);
    const ready = await prisma.idCardOrder.update({ where: { id: paidOrder.id }, data: { status: 'READY', artifactKey: path.basename(artifactPath) } });
    await prisma.idCardOrderEvent.create({ data: { orderId: paidOrder.id, eventType: 'GENERATION_COMPLETED', actorId, details: JSON.stringify({ cardCount: snapshot.students.length }) } });
    return ready;
  } catch (error) {
    await prisma.idCardOrder.update({ where: { id: paidOrder.id }, data: { status: 'GENERATION_FAILED' } });
    await prisma.idCardOrderEvent.create({ data: { orderId: paidOrder.id, eventType: 'GENERATION_FAILED', actorId, details: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown generation failure' }) } });
    throw Object.assign(new Error('Payment is confirmed, but card generation failed. Use retry generation; you will not be charged again.'), { statusCode: 500 });
  }
}

router.post('/orders/:orderId/verify', async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  try {
    const order = await verifyAndGenerate(req.params.orderId, user.schoolId, user.userId);
    res.json({ order: { id: order.id, status: order.status, paymentStatus: order.paymentStatus, amountMinor: order.amountMinor, currency: order.currency } });
  } catch (error) {
    const status = Number((error as any)?.statusCode) || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Unable to verify order.' });
  }
});

router.post('/orders/:orderId/retry-generation', async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  try {
    const order = await verifyAndGenerate(req.params.orderId, user.schoolId, user.userId);
    res.json({ order: { id: order.id, status: order.status, paymentStatus: order.paymentStatus } });
  } catch (error) {
    const status = Number((error as any)?.statusCode) || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : 'Unable to retry generation.' });
  }
});

router.get('/orders', async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const orders = await prisma.idCardOrder.findMany({
    where: { schoolId: user.schoolId },
    include: { quote: { select: { quantity: true, templateId: true, templateTier: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ orders: orders.map((order) => ({ id: order.id, status: order.status, paymentStatus: order.paymentStatus, currency: order.currency, amountMinor: order.amountMinor, createdAt: order.createdAt, quantity: order.quote.quantity, templateId: order.quote.templateId, templateTier: order.quote.templateTier })) });
});

router.get('/orders/:orderId/download', async (req: Request, res: Response) => {
  const user = authenticatedUser(req)!;
  const order = await prisma.idCardOrder.findFirst({ where: { id: req.params.orderId, schoolId: user.schoolId } });
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== 'READY' || order.paymentStatus !== 'PAID' || !order.artifactKey) return res.status(403).json({ error: 'Production cards are available only after verified payment and successful generation.' });

  const storageRoot = path.resolve(process.env.ID_CARD_STORAGE_DIR || path.join(process.cwd(), 'private-storage', 'id-cards'));
  const artifactPath = path.resolve(storageRoot, order.artifactKey);
  if (!artifactPath.startsWith(`${storageRoot}${path.sep}`)) return res.status(404).json({ error: 'Card file not found.' });
  try {
    await readFile(artifactPath);
    res.download(artifactPath, `schoolbase-id-cards-${order.id}.pdf`);
    await prisma.idCardOrderEvent.create({ data: { orderId: order.id, eventType: 'DOWNLOAD', actorId: user.userId } });
  } catch {
    res.status(404).json({ error: 'Card file is no longer available. Contact support.' });
  }
});

export default router;
