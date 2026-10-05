import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { jwtVerify } from 'jose';
import { getSessionSecret } from '../services/security-config.js';
import { DEFAULT_ID_CARD_PRICING_RULE, validateIdCardPricingRule } from '../services/id-card-pricing.js';

const router = Router();
const prisma = new PrismaClient();

async function requirePlatformAdmin(req: Request, res: Response): Promise<string | null> {
  try {
    const token = req.cookies?.schoolbase_session || req.get('x-schoolbase-session');
    if (!token) {
      res.status(401).json({ error: 'Platform administrator session required.' });
      return null;
    }
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (payload.role !== 'PLATFORM_ADMIN' || typeof payload.userId !== 'string') {
      res.status(403).json({ error: 'Platform administrator access required.' });
      return null;
    }
    return payload.userId;
  } catch {
    res.status(401).json({ error: 'Invalid platform administrator session.' });
    return null;
  }
}

function parseRule(ruleJson: string) {
  try {
    const parsed: unknown = JSON.parse(ruleJson);
    return validateIdCardPricingRule(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

router.get('/id-cards/overview', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [orders, activePricing, awards] = await Promise.all([
    prisma.idCardOrder.findMany({
      where: { createdAt: { gte: since } },
      include: { school: { select: { id: true, name: true } }, quote: { select: { quantity: true, templateId: true, templateTier: true } } },
      orderBy: { createdAt: 'desc' },
      take: 250,
    }),
    prisma.idCardPricingRule.findFirst({ where: { isActive: true, effectiveAt: { lte: new Date() } }, orderBy: { effectiveAt: 'desc' } }),
    prisma.idCardUsageAward.findMany({ where: { createdAt: { gte: since } }, select: { status: true, unitsGranted: true, unitsReserved: true, unitsRedeemed: true, valueMinor: true, currency: true } }),
  ]);
  const paidOrders = orders.filter((order) => order.paymentStatus === 'PAID');
  const revenueByCurrency: Record<string, number> = {};
  for (const order of paidOrders) revenueByCurrency[order.currency] = (revenueByCurrency[order.currency] || 0) + order.amountMinor;
  const schools = new Set(orders.map((order) => order.schoolId));
  res.json({
    rangeDays: days,
    metrics: {
      orders: orders.length,
      awaitingPayment: orders.filter((order) => order.paymentStatus === 'PENDING').length,
      paid: paidOrders.length,
      ready: orders.filter((order) => order.status === 'READY').length,
      generationFailed: orders.filter((order) => order.status === 'GENERATION_FAILED').length,
      cardsPaid: paidOrders.reduce((sum, order) => sum + order.quote.quantity, 0),
      schoolsOrdering: schools.size,
      revenueByCurrency,
      premiumCards: orders.filter((order) => order.quote.templateTier === 'PREMIUM').reduce((sum, order) => sum + order.quote.quantity, 0),
      freeAwardUnitsGranted: awards.filter((award) => award.status === 'APPROVED').reduce((sum, award) => sum + award.unitsGranted, 0),
      freeAwardUnitsRedeemed: awards.reduce((sum, award) => sum + award.unitsRedeemed, 0),
      freeAwardFaceValueByCurrency: awards.reduce((totals, award) => {
        totals[award.currency] = (totals[award.currency] || 0) + award.valueMinor;
        return totals;
      }, {} as Record<string, number>),
    },
    activePricing: activePricing ? { version: activePricing.version, currency: activePricing.currency, rule: parseRule(activePricing.ruleJson), effectiveAt: activePricing.effectiveAt } : null,
    orders: orders.map((order) => ({
      id: order.id,
      schoolId: order.schoolId,
      schoolName: order.school.name,
      status: order.status,
      paymentStatus: order.paymentStatus,
      quantity: order.quote.quantity,
      templateId: order.quote.templateId,
      templateTier: order.quote.templateTier,
      currency: order.currency,
      amountMinor: order.amountMinor,
      createdAt: order.createdAt,
    })),
  });
});

router.get('/id-cards/pricing', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const rules = await prisma.idCardPricingRule.findMany({ orderBy: { version: 'desc' }, take: 50 });
  res.json({
    defaultRule: DEFAULT_ID_CARD_PRICING_RULE,
    rules: rules.map((rule) => ({ ...rule, rule: parseRule(rule.ruleJson), ruleJson: undefined })),
  });
});

router.post('/id-cards/pricing', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const rule = req.body?.rule;
  const reason = String(req.body?.reason || '').trim();
  const effectiveAt = req.body?.effectiveAt ? new Date(req.body.effectiveAt) : new Date();
  if (!validateIdCardPricingRule(rule) || reason.length < 8 || Number.isNaN(effectiveAt.getTime())) {
    return res.status(400).json({ error: 'Provide a valid pricing rule, effective date, and change reason.' });
  }
  const latest = await prisma.idCardPricingRule.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
  const created = await prisma.idCardPricingRule.create({
    data: {
      version: (latest?.version || 0) + 1,
      currency: rule.currency,
      ruleJson: JSON.stringify(rule),
      isActive: false,
      effectiveAt,
      reason,
      createdBy: adminId,
    },
  });
  res.status(201).json({ rule: { id: created.id, version: created.version, currency: created.currency, rule, isActive: false, effectiveAt: created.effectiveAt, reason: created.reason, createdBy: created.createdBy } });
});

router.post('/id-cards/pricing/:ruleId/approve', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const rule = await prisma.idCardPricingRule.findUnique({ where: { id: req.params.ruleId } });
  if (!rule) return res.status(404).json({ error: 'Pricing draft not found.' });
  if (rule.createdBy === adminId) return res.status(403).json({ error: 'A different platform administrator must approve this pricing change.' });
  if (rule.isActive) return res.status(409).json({ error: 'Pricing rule is already active.' });
  if (!parseRule(rule.ruleJson)) return res.status(409).json({ error: 'Pricing draft is invalid.' });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.idCardPricingRule.updateMany({ where: { isActive: true }, data: { isActive: false } });
    await tx.idCardPricingRule.update({ where: { id: rule.id }, data: { isActive: true, effectiveAt: rule.effectiveAt > now ? rule.effectiveAt : now, approvedBy: adminId } });
  });
  res.json({ success: true, ruleId: rule.id, approvedBy: adminId });
});

router.get('/id-cards/awards', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const awards = await prisma.idCardUsageAward.findMany({
    include: { school: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 250,
  });
  res.json({ awards: awards.map(({ eligibleTiersJson, school, ...award }) => ({ ...award, schoolName: school.name, eligibleTiers: JSON.parse(eligibleTiersJson) })) });
});

router.post('/id-cards/awards', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const schoolId = String(req.body?.schoolId || '').trim();
  const awardType = String(req.body?.awardType || '').trim().toUpperCase();
  const unitsGranted = Number(req.body?.unitsGranted || 0);
  const valueMinor = Number(req.body?.valueMinor || 0);
  const currency = String(req.body?.currency || 'NGN').toUpperCase();
  const reasonCategory = String(req.body?.reasonCategory || '').trim().toUpperCase();
  const reason = String(req.body?.reason || '').trim();
  const eligibleTiers = Array.isArray(req.body?.eligibleTiers) ? req.body.eligibleTiers.filter((tier: unknown) => tier === 'STANDARD' || tier === 'PREMIUM') : [];
  const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
  const categoryAllowed = ['TRIAL', 'ONBOARDING', 'SERVICE_RECOVERY', 'PARTNER', 'CAMPAIGN'].includes(reasonCategory);
  if (!schoolId || !['UNITS', 'VALUE', 'FULL_ORDER'].includes(awardType) || !categoryAllowed || reason.length < 8 || eligibleTiers.length === 0 || !/^[A-Z]{3}$/.test(currency) || (expiresAt && Number.isNaN(expiresAt.getTime()))) {
    return res.status(400).json({ error: 'Award details are incomplete or invalid.' });
  }
  if (awardType === 'UNITS' && (!Number.isInteger(unitsGranted) || unitsGranted < 1 || unitsGranted > 1000)) return res.status(400).json({ error: 'Award units must be between 1 and 1,000.' });
  if (awardType === 'VALUE' && (!Number.isInteger(valueMinor) || valueMinor < 1)) return res.status(400).json({ error: 'Award value must be a positive amount in minor currency units.' });
  if (awardType === 'FULL_ORDER' && unitsGranted < 1) return res.status(400).json({ error: 'A full-order award needs a maximum card quantity.' });
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
  if (!school) return res.status(404).json({ error: 'School not found.' });

  const award = await prisma.idCardUsageAward.create({
    data: {
      schoolId,
      awardType,
      unitsGranted: awardType === 'VALUE' ? 0 : unitsGranted,
      valueMinor: awardType === 'UNITS' ? 0 : valueMinor,
      currency,
      eligibleTiersJson: JSON.stringify(Array.from(new Set(eligibleTiers))),
      reasonCategory,
      campaign: typeof req.body?.campaign === 'string' ? req.body.campaign.trim().slice(0, 191) : null,
      internalNote: typeof req.body?.internalNote === 'string' ? req.body.internalNote.trim() : null,
      terms: typeof req.body?.terms === 'string' ? req.body.terms.trim() : null,
      status: 'PENDING_APPROVAL',
      expiresAt,
      createdBy: adminId,
    },
  });
  await prisma.idCardAwardLedger.create({ data: { awardId: award.id, entryType: 'AWARD_CREATED', units: award.unitsGranted, amountMinor: award.valueMinor, actorId: adminId, reason } });
  res.status(201).json({ award: { id: award.id, status: award.status, schoolId: award.schoolId, awardType: award.awardType, unitsGranted: award.unitsGranted, valueMinor: award.valueMinor, currency: award.currency, expiresAt: award.expiresAt } });
});

router.post('/id-cards/awards/:awardId/approve', async (req, res) => {
  const adminId = await requirePlatformAdmin(req, res);
  if (!adminId) return;
  const award = await prisma.idCardUsageAward.findUnique({ where: { id: req.params.awardId } });
  if (!award) return res.status(404).json({ error: 'Award not found.' });
  if (award.createdBy === adminId) return res.status(403).json({ error: 'A different platform administrator must approve this award.' });
  if (award.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: 'Award is not awaiting approval.' });
  await prisma.$transaction(async (tx) => {
    await tx.idCardUsageAward.update({ where: { id: award.id }, data: { status: 'APPROVED', approvedBy: adminId } });
    await tx.idCardAwardLedger.create({ data: { awardId: award.id, entryType: 'AWARD_APPROVED', actorId: adminId, reason: 'Second-admin approval' } });
  });
  res.json({ success: true, awardId: award.id });
});

export default router;
