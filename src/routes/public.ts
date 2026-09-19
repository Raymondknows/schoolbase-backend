import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import ReportCardService from '../services/report-card.service.js';
import { sendPlatformCommunicationEmail } from '../services/email.js';
import { CommunicationService, RulesEngine, TemplateEngine, RecipientResolver, DeliveryQueue, DriverManager, EmailDriver, WhatsAppDriver } from '../communications/index.js';
import baileysSessionManager from '../communications/whatsapp-baileys.js';
import { CommunicationRulesRegistry, DEFAULT_COMMUNICATION_RULES } from '../communications/rules.js';
import { normalizeAdmissionStatus } from './admissions-utils.js';
import { getConfiguredPaymentPlans, getPublicPaymentPlans } from '../services/platform-settings.js';
import { isValidLandingUrl, normalizePlacementType } from './ads-utils.js';
import { sendAdvertiserApplicationNotification, sendAdvertiserStatusEmail } from '../services/email.js';

type PublicAdmissionsSchool = {
  id: string;
  name: string;
  slug: string;
  primaryColor: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  admissionsEnabled: boolean;
  admissionsOpeningDate: Date | null;
  admissionsClosingDate: Date | null;
  admissionsIntroText: string | null;
  admissionsRequirements: string | null;
  admissionsContactInfo: string | null;
  email: string | null;
  phone: string | null;
  classes: {
    id: string;
    name: string;
    phase: string;
    arm: string | null;
  }[];
};

type ExtendedPrismaClient = PrismaClient & {
  resultPin: any;
  resultPinBatch: any;
  admissionApplication: any;
};

const router = Router();
const prisma = new PrismaClient() as ExtendedPrismaClient;
const adApplicationAttempts = new Map<string, number[]>();

router.get('/pricing', async (_req: Request, res: Response) => {
  try {
    const plans = await getConfiguredPaymentPlans(prisma);
    if (!plans) return res.status(503).json({ error: 'Pricing is temporarily unavailable.' });
    res.json({ plans: getPublicPaymentPlans(plans) });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load pricing.' });
  }
});

async function handleAdPlacementRequest(req: Request, res: Response) {
  const requestedPath = String(req.query.path ?? '/login');
  const placementType = normalizePlacementType(requestedPath);
  const eventName = String(req.query.event ?? '').trim().toLowerCase();
  const campaignId = typeof req.query.id === 'string' ? req.query.id : null;

  if (eventName && campaignId) {
    const campaign = await prisma.adCampaign.findUnique({ where: { id: campaignId }, select: { id: true, status: true, enabled: true } });
    if (!campaign || campaign.status !== 'LIVE' || !campaign.enabled) {
      return res.status(403).json({ success: false, message: 'Campaign is not active' });
    }

    await prisma.adAnalyticsEvent.create({
      data: {
        campaignId: campaign.id,
        placementId: null,
        eventType: eventName === 'click' ? 'CLICK' : 'IMPRESSION',
        sourcePath: requestedPath,
        userAgent: req.headers['user-agent'] ?? null,
        referrer: req.headers.referer ?? null,
      },
    }).catch(() => {});

    return res.json({ success: true, recorded: eventName });
  }

  const placement = await prisma.adPlacement.findUnique({
    where: { type: placementType as any },
    include: { campaigns: { include: { campaign: { include: { creatives: { orderBy: { createdAt: 'asc' } }, advertiser: true } } } } },
  });

  if (!placement) {
    return res.json({ placementType, ads: [] });
  }

  const now = new Date();
  const activeAds = placement.campaigns
    .map((entry) => entry.campaign)
    .filter((campaign) => {
      const withinDates = (!campaign.startDate || campaign.startDate <= now) && (!campaign.endDate || campaign.endDate >= now);
      return campaign.status === 'LIVE' && campaign.enabled && campaign.approvedAt && withinDates && campaign.advertiser.verificationStatus === 'VERIFIED';
    })
    .filter((campaign) => campaign.landingUrl && isValidLandingUrl(campaign.landingUrl))
    .slice(0, 1)
    .map((campaign) => {
      const primaryCreative = campaign.creatives[0] ?? null;
      return {
        id: campaign.id,
        title: campaign.title,
        headline: campaign.headline || primaryCreative?.headline || campaign.title,
        summary: campaign.summary || primaryCreative?.description || '',
        landingUrl: campaign.landingUrl,
        label: placement.label,
        imageUrl: primaryCreative?.imageUrl || null,
        ctaText: primaryCreative?.ctaText || 'Learn more',
        description: primaryCreative?.description || campaign.summary || '',
        advertiser: campaign.advertiser.companyName,
      };
    });

  return res.json({ placementType, ads: activeAds });
}

router.get('/ads/placements', async (req: Request, res: Response) => {
  await handleAdPlacementRequest(req, res);
});

router.post('/ads/placements', async (req: Request, res: Response) => {
  await handleAdPlacementRequest(req, res);
});

router.post('/ads/apply', async (req: Request, res: Response) => {
  const { companyName, contactName, email, phone, website, category, campaignTitle, headline, summary, landingUrl, placementTypes = [], budget, currency = 'NGN', companyWebsite = '' } = req.body || {};
  const honeypot = String(req.body?.companyWebsite || companyWebsite || '').trim();
  if (honeypot) return res.status(400).json({ message: 'Unable to submit application.' });

  const normalizedHeadline = headline ? String(headline).trim() : String(campaignTitle || '').trim();

  const clientKey = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recentAttempts = (adApplicationAttempts.get(clientKey) || []).filter((timestamp) => now - timestamp < 60 * 60 * 1000);
  if (recentAttempts.length >= 5) return res.status(429).json({ message: 'Too many applications from this network. Please try again later.' });
  recentAttempts.push(now);
  adApplicationAttempts.set(clientKey, recentAttempts);

  const requiredValues = [companyName, contactName, email, campaignTitle, landingUrl];
  if (requiredValues.some((value) => !String(value || '').trim())) {
    return res.status(400).json({ message: 'Company, contact, email, campaign title, and landing URL are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return res.status(400).json({ message: 'Enter a valid contact email.' });
  }
  if (!isValidLandingUrl(String(landingUrl).trim())) {
    return res.status(400).json({ message: 'Landing URL must use http or https.' });
  }
  if (String(companyName).trim().length > 160 || String(contactName).trim().length > 120 || String(campaignTitle).trim().length > 160 || String(summary || '').trim().length > 2000) {
    return res.status(400).json({ message: 'One or more fields are too long.' });
  }

  const requestedTypes = Array.isArray(placementTypes) ? placementTypes.map((value) => String(value)) : [];
  const placements = await prisma.adPlacement.findMany({
    where: { type: { in: requestedTypes as any }, enabled: true },
    select: { id: true },
  });
  if (requestedTypes.length > 0 && placements.length !== new Set(requestedTypes).size) {
    return res.status(400).json({ message: 'One or more selected placements are unavailable.' });
  }

  const existingApplication = await prisma.advertiser.findFirst({
    where: { email: String(email).trim(), verificationStatus: 'PENDING', campaigns: { some: { status: 'DRAFT' } } },
    select: { id: true },
  });
  if (existingApplication) return res.status(409).json({ message: 'An application from this email is already awaiting review.' });

  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const advertiser = await tx.advertiser.create({
        data: {
          companyName: String(companyName).trim(),
          contactName: String(contactName).trim(),
          email: String(email).trim(),
          phone: phone ? String(phone).trim() : null,
          website: website ? String(website).trim() : null,
          category: category ? String(category).trim() : null,
          verificationStatus: 'PENDING',
          notes: 'Submitted through the public Advertise with SchoolBase form.',
        },
      });
      const campaign = await tx.adCampaign.create({
        data: {
          advertiserId: advertiser.id,
          title: String(campaignTitle).trim(),
          slug: `${String(campaignTitle).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
          headline: normalizedHeadline || null,
          summary: summary ? String(summary).trim() : null,
          landingUrl: String(landingUrl).trim(),
          budget: Number(budget || 0),
          currency: String(currency || 'NGN').trim(),
          status: 'DRAFT',
          enabled: false,
          placements: placements.length ? { createMany: { data: placements.map((placement: { id: string }) => ({ placementId: placement.id })) } } : undefined,
        },
      });
      return { advertiserId: advertiser.id, campaignId: campaign.id };
    });
    await sendAdvertiserApplicationNotification({ companyName: String(companyName).trim(), contactName: String(contactName).trim(), email: String(email).trim(), campaignTitle: String(campaignTitle).trim(), landingUrl: String(landingUrl).trim(), placementTypes: requestedTypes }).catch((error) => console.error('[PUBLIC ADS] Internal notification failed:', error));
    await sendAdvertiserStatusEmail({ email: String(email).trim(), contactName: String(contactName).trim(), companyName: String(companyName).trim(), status: 'RECEIVED' }).catch((error) => console.error('[PUBLIC ADS] Applicant confirmation email failed:', error));
    return res.status(201).json({ success: true, message: 'Application received. SchoolBase will review it and contact you.', ...result });
  } catch (error) {
    console.error('[PUBLIC ADS] Application failed:', error);
    return res.status(500).json({ message: 'Unable to submit the advertising application right now.' });
  }
});

const reportCardService = new ReportCardService(prisma);

const publicCommunicationRulesRegistry = new CommunicationRulesRegistry(DEFAULT_COMMUNICATION_RULES);

const publicSharedDriverManager = new DriverManager({
  EMAIL: new EmailDriver(async ({ recipient, request }) => {
    const schoolName = String(request.data?.schoolName ?? 'SchoolBase');
    const subject = String(request.subject ?? 'Admission notification');
    const body = String(request.body ?? '');
    await sendPlatformCommunicationEmail(
      recipient.address,
      recipient.name ?? 'Recipient',
      schoolName,
      subject,
      subject,
      body,
    );

    return {
      channel: 'EMAIL',
      recipient: recipient.address,
      status: 'SENT',
      provider: 'email-service',
    } as const;
  }),
  WHATSAPP: new WhatsAppDriver(async ({ recipient, request, content }) => {
    const schoolId = request.schoolId ?? '';
    const result = await baileysSessionManager.sendTextMessage(schoolId, recipient.address, content.body) as { success: boolean; messageId?: string; error?: string };

    if (!result.success) {
      return {
        channel: 'WHATSAPP',
        recipient: recipient.address,
        status: 'FAILED',
        provider: 'baileys',
        error: result.error,
      } as const;
    }

    return {
      channel: 'WHATSAPP',
      recipient: recipient.address,
      status: 'SENT',
      provider: 'baileys',
      messageId: result.messageId,
    } as const;
  }),
});

const publicSharedDeliveryQueue = new DeliveryQueue(publicSharedDriverManager.send.bind(publicSharedDriverManager));

function createPublicCommunicationService() {
  return new CommunicationService({
    rulesEngine: new RulesEngine(publicCommunicationRulesRegistry),
    templateEngine: new TemplateEngine(),
    recipientResolver: new RecipientResolver(),
    deliveryQueue: publicSharedDeliveryQueue,
    driverManager: publicSharedDriverManager,
  });
}

function getPublicGrade(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function buildPublicResultPayloadItem(input: {
  assessmentId: string;
  assessmentName?: string | null;
  termName?: string | null;
  termId?: string | null;
  totalScore?: number | null;
  caScore?: number | null;
  testScore?: number | null;
  examScore?: number | null;
  grade?: string | null;
}) {
  return {
    id: input.assessmentId,
    assessmentId: input.assessmentId,
    term: input.termName ?? 'Unknown term',
    termId: input.termId ?? null,
    subject: input.assessmentName ?? 'Assessment',
    totalScore: input.totalScore ?? null,
    caScore: input.caScore ?? null,
    testScore: input.testScore ?? null,
    examScore: input.examScore ?? null,
    grade: input.grade ?? null,
  };
}

function normalizePublicAdmissionValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

type AdmissionNotificationSchool = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

async function notifyAdmissionSubmissionRecipients(
  school: AdmissionNotificationSchool,
  application: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    childName: string | null;
    intendedClass: string | null;
    note: string | null;
    createdAt: Date;
    guardianEmail: string | null;
  }
) {
  const schoolSubject = 'New admission application received';
  const schoolBody = `A new admission application has been submitted for ${school.name}.

Applicant: ${application.firstName} ${application.lastName}
Email: ${application.email ?? 'N/A'}
Phone: ${application.phone ?? 'N/A'}
Student: ${application.childName ?? 'N/A'}
Intended Class: ${application.intendedClass ?? 'N/A'}
Submitted At: ${application.createdAt.toLocaleString()}

Review the application in the admissions admin dashboard.`;

  const applicantSubject = 'Your admission application has been received';
  const applicantBody = `Hello ${application.firstName} ${application.lastName},

Thank you for applying to ${school.name}. We have received your admission request for ${application.childName ?? 'your child'} in ${application.intendedClass ?? 'the requested class'}.

Our admissions team will review your application and contact you with the next update.

If you need help, you can reply to this email or contact the school directly.`;

  const recipients = [] as Array<{ channel: 'EMAIL' | 'WHATSAPP'; address: string; name: string }>;
  if (school.email) {
    recipients.push({ channel: 'EMAIL', address: school.email, name: 'Admissions Team' });
  }
  if (school.phone) {
    recipients.push({ channel: 'WHATSAPP', address: school.phone, name: 'Admissions Team' });
  }
  if (application.email) {
    recipients.push({ channel: 'EMAIL', address: application.email, name: `${application.firstName} ${application.lastName}`.trim() || 'Applicant' });
  }
  if (application.phone) {
    recipients.push({ channel: 'WHATSAPP', address: application.phone, name: `${application.firstName} ${application.lastName}`.trim() || 'Applicant' });
  }

  if (recipients.length === 0) {
    return;
  }

  const communicationService = createPublicCommunicationService();

  await communicationService.dispatch({
    event: 'AdmissionCreated',
    schoolId: school.id,
    recipients,
    template: 'Admission',
    subject: schoolSubject,
    body: schoolBody,
    data: {
      schoolName: school.name,
      studentName: application.childName ?? `${application.firstName} ${application.lastName}`.trim(),
      className: application.intendedClass ?? 'N/A',
      admissionNo: 'N/A',
      recipientName: `${application.firstName} ${application.lastName}`.trim(),
    },
    metadata: {
      schoolName: school.name,
      studentName: application.childName ?? `${application.firstName} ${application.lastName}`.trim(),
      className: application.intendedClass ?? 'N/A',
      admissionNo: 'N/A',
    },
  });
}

const publicUploadDir = path.join(process.cwd(), 'uploads', 'photos');
if (!fs.existsSync(publicUploadDir)) {
  fs.mkdirSync(publicUploadDir, { recursive: true });
}

const publicStorage = multer.diskStorage({
  destination: publicUploadDir,
  filename: (_req, _file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    cb(null, uniqueName);
  },
});

const publicFileFilter = (_req: any, file: any, cb: any) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const publicUpload = multer({
  storage: publicStorage,
  fileFilter: publicFileFilter,
  limits: { fileSize: 4 * 1024 * 1024 },
});

export async function resolveSchoolForPublicResultCheck(prismaClient: PrismaClient, schoolCode: string) {
  const normalizedInput = String(schoolCode ?? '').trim();
  const compactInput = normalizedInput.replace(/\s+/g, ' ').trim();
  const slugCandidates = [compactInput.toLowerCase(), compactInput.toLowerCase().replace(/\s+/g, '-'), compactInput.replace(/\s+/g, '-').toLowerCase()];
  const initialsCandidates = [compactInput.replace(/\s+/g, '').toUpperCase(), compactInput.toUpperCase()];
  const nameCandidates = [compactInput, compactInput.toLowerCase(), compactInput.toUpperCase()];

  const results = await prismaClient.school.findMany({
    where: {
      OR: [
        { slug: { in: slugCandidates } },
        { initials: { in: initialsCandidates } },
        { name: { contains: compactInput } },
        { name: { contains: compactInput.toLowerCase() } },
        { name: { contains: compactInput.toUpperCase() } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      initials: true,
      resultAccessPinEnabled: true,
      resultAccessMode: true,
    },
  });

  if (!results.length) {
    return null;
  }

  const normalizedWanted = compactInput.toLowerCase().replace(/\s+/g, ' ');

  const exactMatch = results.find((school) => {
    if (!school.slug || !compactInput) return false;
    const name = (school.name || '').toLowerCase().replace(/\s+/g, ' ');
    const slug = (school.slug || '').toLowerCase().replace(/\s+/g, '-');
    const initials = (school.initials || '').toUpperCase().replace(/\s+/g, '');
    return slug === normalizedWanted.replace(/\s+/g, '-') || name === normalizedWanted || initials === compactInput.replace(/\s+/g, '').toUpperCase();
  });

  return exactMatch ?? results[0] ?? null;
}

router.get('/admissions/:schoolSlug/settings', async (req: Request, res: Response) => {
  try {
    const schoolSlug = String(req.params.schoolSlug ?? '').trim();
    if (!schoolSlug) {
      return res.status(400).json({ error: 'School slug is required' });
    }

    const school = await prisma.school.findUnique({
      where: { slug: schoolSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        primaryColor: true,
        address: true,
        city: true,
        admissionsEnabled: true,
        admissionsOpeningDate: true,
        admissionsClosingDate: true,
        admissionsIntroText: true,
        admissionsRequirements: true,
        admissionsContactInfo: true,
        email: true,
        phone: true,
        classes: {
          select: {
            id: true,
            name: true,
            phase: true,
            arm: true,
          },
          orderBy: [
            { phase: 'asc' },
            { name: 'asc' },
          ],
        },
      },
    }) as PublicAdmissionsSchool | null;

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const requirements = (school.admissionsRequirements ?? '')
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean);

    res.json({
      ok: true,
      enabled: Boolean(school.admissionsEnabled),
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        logoUrl: school.logoUrl,
        primaryColor: school.primaryColor,
        address: school.address,
        city: school.city,
        email: school.email,
        phone: school.phone,
      },
      classes: school.classes,
      openingDate: school.admissionsOpeningDate ? school.admissionsOpeningDate.toISOString() : null,
      closingDate: school.admissionsClosingDate ? school.admissionsClosingDate.toISOString() : null,
      introText: school.admissionsIntroText || `Apply online for ${school.name} in just a few steps.`,
      requirements: requirements.length > 0 ? requirements : [
        'Provide the applicant details and parent contact information.',
        'Share your preferred class or grade level.',
        'Our admissions team will review your request and get back to you shortly.',
      ],
      contactInfo: school.admissionsContactInfo || `Email: ${school.email || 'N/A'} • Phone: ${school.phone || 'N/A'}`,
    });
  } catch (error) {
    console.error('Error fetching public admissions settings:', error);
    res.status(500).json({ error: 'Failed to fetch admissions information' });
  }
});

router.post('/admissions', (req: Request, res: Response, next: any) => {
  if (!req.is('multipart/form-data')) {
    return next();
  }

  publicUpload.single('photo')(req, res, (uploadError: any) => {
    if (uploadError) {
      console.error('Public admissions photo upload error:', uploadError);
      return res.status(400).json({ error: uploadError.message || 'Invalid photo upload' });
    }

    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const schoolSlug = normalizePublicAdmissionValue(req.body?.schoolSlug);
    const firstName = normalizePublicAdmissionValue(req.body?.firstName);
    const lastName = normalizePublicAdmissionValue(req.body?.lastName);
    const email = normalizePublicAdmissionValue(req.body?.email);
    const phone = normalizePublicAdmissionValue(req.body?.phone);
    const studentFirstName = normalizePublicAdmissionValue(req.body?.studentFirstName) ?? normalizePublicAdmissionValue(req.body?.childName);
    const studentMiddleName = normalizePublicAdmissionValue(req.body?.studentMiddleName);
    const studentLastName = normalizePublicAdmissionValue(req.body?.studentLastName) ?? normalizePublicAdmissionValue(req.body?.childName);
    const studentEmail = normalizePublicAdmissionValue(req.body?.studentEmail);
    const studentPhone = normalizePublicAdmissionValue(req.body?.studentPhone);
    const gender = normalizePublicAdmissionValue(req.body?.gender);
    const dateOfBirth = req.body?.dateOfBirth ? new Date(req.body.dateOfBirth) : null;
    const admissionDate = req.body?.admissionDate ? new Date(req.body.admissionDate) : null;
    const intendedClass = normalizePublicAdmissionValue(req.body?.intendedClass);
    const address = normalizePublicAdmissionValue(req.body?.address);
    const bloodGroup = normalizePublicAdmissionValue(req.body?.bloodGroup);
    const genotype = normalizePublicAdmissionValue(req.body?.genotype);
    const medicalNotes = normalizePublicAdmissionValue(req.body?.medicalNotes);
    const previousSchool = normalizePublicAdmissionValue(req.body?.previousSchool);
    const previousClass = normalizePublicAdmissionValue(req.body?.previousClass);
    const guardianFirst = normalizePublicAdmissionValue(req.body?.guardianFirst) ?? firstName;
    const guardianLast = normalizePublicAdmissionValue(req.body?.guardianLast) ?? lastName;
    const guardianRelationship = normalizePublicAdmissionValue(req.body?.guardianRelationship) ?? 'Parent';
    const guardianEmail = normalizePublicAdmissionValue(req.body?.guardianEmail) ?? email;
    const guardianPhone = normalizePublicAdmissionValue(req.body?.guardianPhone) ?? phone;
    const guardianAltPhone = normalizePublicAdmissionValue(req.body?.guardianAltPhone);
    const guardianOccupation = normalizePublicAdmissionValue(req.body?.guardianOccupation);
    const note = normalizePublicAdmissionValue(req.body?.note);
    const requestId = normalizePublicAdmissionValue(req.headers['x-admission-request-id']);
    const parentName = `${guardianFirst || firstName || ''} ${guardianLast || lastName || ''}`.trim() || null;
    const childName = `${studentFirstName || ''} ${studentLastName || ''}`.trim() || null;

    if (!schoolSlug || !firstName || !lastName || !email || !phone || !studentFirstName || !studentLastName) {
      return res.status(400).json({ error: 'School, applicant name, applicant email, applicant phone, and student name are required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid applicant email address' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a student photo before submitting' });
    }

    const school = await prisma.school.findUnique({
      where: { slug: schoolSlug },
      select: { id: true, name: true, slug: true, email: true, phone: true, admissionsContactInfo: true, address: true, primaryColor: true, logoUrl: true, city: true, admissionsEnabled: true, admissionsOpeningDate: true, admissionsClosingDate: true, admissionsIntroText: true, admissionsRequirements: true },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const now = new Date();
    if (!school.admissionsEnabled) {
      return res.status(403).json({ error: 'Online admissions are currently closed' });
    }

    if (school.admissionsOpeningDate && now < school.admissionsOpeningDate) {
      return res.status(403).json({
        error: 'Online admissions are not open yet',
        openingDate: school.admissionsOpeningDate.toISOString(),
      });
    }

    if (school.admissionsClosingDate && now > school.admissionsClosingDate) {
      return res.status(403).json({
        error: 'Online admissions are closed',
        closingDate: school.admissionsClosingDate.toISOString(),
      });
    }

    if (requestId) {
      const previousApplication = await prisma.admissionApplication.findFirst({
        where: { schoolId: school.id, applicationNumber: requestId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          childName: true,
          intendedClass: true,
          status: true,
          createdAt: true,
        },
      });

      if (previousApplication) {
        return res.status(200).json({
          ok: true,
          message: 'Admission request already received.',
          application: {
            ...previousApplication,
            status: normalizeAdmissionStatus(previousApplication.status),
          },
        });
      }
    }

    const application = await prisma.admissionApplication.create({
      data: {
        schoolId: school.id,
        applicationNumber: requestId,
        firstName,
        lastName,
        email,
        phone,
        childName,
        dateOfBirth: Number.isNaN(dateOfBirth?.getTime()) ? null : dateOfBirth,
        intendedClass: intendedClass ?? null,
        parentName,
        note: note ?? null,
        status: 'SUBMITTED',
        studentFirstName,
        studentMiddleName,
        studentLastName,
        studentEmail,
        studentPhone,
        gender,
        admissionDate: Number.isNaN(admissionDate?.getTime()) ? null : admissionDate,
        address: address ?? null,
        bloodGroup: bloodGroup ?? null,
        genotype: genotype ?? null,
        medicalNotes: medicalNotes ?? null,
        previousSchool: previousSchool ?? null,
        previousClass: previousClass ?? null,
        photoUrl: req.file ? `/uploads/photos/${req.file.filename}` : null,
        guardianFirst,
        guardianLast,
        guardianRelationship,
        guardianEmail,
        guardianPhone,
        guardianAltPhone,
        guardianOccupation,
        studentId: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        childName: true,
        intendedClass: true,
        status: true,
        createdAt: true,
      },
    }) as {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      childName: string | null;
      intendedClass: string | null;
      status: string;
      createdAt: Date;
    };

    try {
      await notifyAdmissionSubmissionRecipients(school, {
        id: application.id,
        firstName: application.firstName,
        lastName: application.lastName,
        email: application.email,
        phone: application.phone,
        childName: application.childName,
        intendedClass: application.intendedClass,
        note: note ?? null,
        createdAt: application.createdAt,
        guardianEmail,
      });
    } catch (notificationError) {
      console.warn('Failed to send admission submission notification:', notificationError);
    }

    res.status(201).json({
      ok: true,
      message: 'Admission request received. Our team will review it shortly.',
      application: {
        ...application,
        status: normalizeAdmissionStatus(application.status),
      },
    });
  } catch (error) {
    console.error('Error creating public admission application:', error);
    res.status(500).json({ error: 'Failed to submit admission request' });
  }
});

router.get('/admissions/status', async (req: Request, res: Response) => {
  try {
    const schoolSlug = normalizePublicAdmissionValue(req.query.schoolSlug);
    const email = normalizePublicAdmissionValue(req.query.email);

    if (!schoolSlug || !email) {
      return res.status(400).json({ error: 'School slug and email are required' });
    }

    const school = await prisma.school.findUnique({
      where: { slug: schoolSlug },
      select: { id: true },
    });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const application = await prisma.admissionApplication.findFirst({
      where: {
        schoolId: school.id,
        email,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        createdAt: true,
      },
    }) as {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      status: string;
      createdAt: Date;
    } | null;

    if (!application) {
      return res.status(404).json({ error: 'No admission request found for that email' });
    }

    res.json({
      ok: true,
      application: {
        ...application,
        status: normalizeAdmissionStatus(application.status),
      },
    });
  } catch (error) {
    console.error('Error fetching admissions status:', error);
    res.status(500).json({ error: 'Failed to fetch admissions status' });
  }
});

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

router.post('/results/check', async (req: Request, res: Response) => {
  try {
    const schoolCode = String(req.body?.schoolCode ?? '').trim().toLowerCase();
    const admissionNo = String(req.body?.admissionNo ?? '').trim();
    const pin = String(req.body?.pin ?? '').trim();
    const termId = String(req.body?.termId ?? '').trim();

    if (!schoolCode || !admissionNo) {
      return res.status(400).json({ error: 'School code and admission number are required' });
    }

    const school = await resolveSchoolForPublicResultCheck(prisma, schoolCode);

    if (!school) {
      return res.status(404).json({ error: 'School not found for the provided school code' });
    }

    const pinAccessEnabled = Boolean(school.resultAccessPinEnabled);
    const mode = school.resultAccessMode || 'NONE';
    if (mode === 'PARENT_PORTAL_ONLY') {
      return res.status(403).json({
        error: 'This school only allows parent-portal result access',
        requiresPin: false,
      });
    }

    const pupil = await prisma.pupil.findFirst({
      where: {
        schoolId: school.id,
        admissionNo,
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            phase: true,
          },
        },
      },
    });

    if (!pupil || !pupil.class) {
      return res.status(404).json({ error: 'Student record not found for the supplied admission number' });
    }

    const publishedAssessmentWhere: any = {
      schoolId: school.id,
      phase: pupil.class.phase,
      status: 'PUBLISHED',
    };

    if (!pinAccessEnabled) {
      const where: any = { ...publishedAssessmentWhere };

      if (termId && termId !== 'latest') {
        where.termId = termId;
      }

      const assessments = await prisma.assessment.findMany({
        where,
        include: {
          term: {
            select: { id: true, name: true, sortOrder: true },
          },
          results: {
            where: { pupilId: pupil.id },
            select: {
              id: true,
              caScore: true,
              testScore: true,
              examScore: true,
              totalScore: true,
            },
          },
        },
        orderBy: [
          { term: { sortOrder: 'desc' } },
          { createdAt: 'desc' },
        ],
      });

      const resultPayload = assessments.map((assessment) => {
        const result = assessment.results[0];
        const totalScore = result?.totalScore ?? null;
        return buildPublicResultPayloadItem({
          assessmentId: assessment.id,
          assessmentName: assessment.name ?? 'Assessment',
          termName: assessment.term?.name ?? 'Unknown term',
          termId: assessment.term?.id ?? null,
          totalScore,
          caScore: result?.caScore ?? null,
          testScore: result?.testScore ?? null,
          examScore: result?.examScore ?? null,
          grade: getPublicGrade(totalScore) ?? null,
        });
      });

      const reportCards = await Promise.all(
        assessments.map(async (assessment) => {
          try {
            const reportCardData = await reportCardService.generateReportCard(assessment.id, pupil.id, school.id);
            return {
              assessmentId: assessment.id,
              ...reportCardData,
            };
          } catch (error) {
            console.error('Error generating public report card payload:', error);
            return null;
          }
        })
      );

      const hasPublishedResults = resultPayload.length > 0 || reportCards.some(Boolean);

      return res.json({
        ok: true,
        requiresPin: false,
        message: hasPublishedResults ? null : 'No published results are available yet for this student.',
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          mode: school.resultAccessMode || 'NONE',
        },
        student: {
          id: pupil.id,
          firstName: pupil.firstName,
          lastName: pupil.lastName,
          admissionNo: pupil.admissionNo,
          className: pupil.class?.name ?? null,
        },
        results: resultPayload,
        reportCards: reportCards.filter(Boolean),
        term: assessments[0]?.term ?? null,
      });
    }

    // Only require a PIN when the school has explicitly enabled PIN-protected result access.
    if (!pin) {
      return res.status(403).json({
        error: 'PIN is required to view results',
        requiresPin: true,
        student: {
          id: pupil.id,
          firstName: pupil.firstName,
          lastName: pupil.lastName,
          admissionNo: pupil.admissionNo,
          className: pupil.class?.name ?? null,
        },
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
          mode: school.resultAccessMode || 'NONE',
        },
      });
    }

    const effectiveTermId = termId && termId !== 'latest' ? termId : null;

    const candidates = await prisma.resultPin.findMany({
      where: {
        schoolId: school.id,
        status: 'ACTIVE',
        OR: [
          { studentId: pupil.id },
          { studentId: null },
        ],
        ...(effectiveTermId ? { termId: effectiveTermId } : {}),
      },
      select: {
        id: true,
        pinHash: true,
        type: true,
        studentId: true,
        expiresAt: true,
        termId: true,
        assessmentId: true,
      },
      orderBy: { generatedAt: 'desc' },
    });

    const now = Date.now();
    let matchedPin: { id: string; type: string; studentId: string | null; termId: string | null; assessmentId: string | null } | null = null;

    for (const candidate of candidates) {
      if (candidate.expiresAt && new Date(candidate.expiresAt).getTime() < now) {
        continue;
      }

      const matches = await bcrypt.compare(pin, candidate.pinHash);
      if (!matches) {
        continue;
      }

      if (candidate.type === 'GENERIC' && !candidate.studentId) {
        await prisma.resultPin.update({
          where: { id: candidate.id },
          data: { studentId: pupil.id, assignedAt: new Date() },
        });
      }

      matchedPin = candidate;
      break;
    }

    if (!matchedPin) {
      return res.status(403).json({ error: 'The supplied PIN is invalid or has expired' });
    }

    const where: any = { ...publishedAssessmentWhere };

    const pinTermId = matchedPin?.termId && matchedPin.termId !== 'latest' ? matchedPin.termId : null;
    const resolvedTermId = effectiveTermId || pinTermId;

    if (resolvedTermId) {
      where.termId = resolvedTermId;
    }

    const assessments = await prisma.assessment.findMany({
      where,
      include: {
        term: {
          select: { id: true, name: true, sortOrder: true },
        },
        results: {
          where: { pupilId: pupil.id },
          select: {
            id: true,
            caScore: true,
            testScore: true,
            examScore: true,
            totalScore: true,
          },
        },
      },
      orderBy: [
        { term: { sortOrder: 'desc' } },
        { createdAt: 'desc' },
      ],
    });

    const resultPayload = assessments.map((assessment) => {
      const result = assessment.results[0];
      const totalScore = result?.totalScore ?? null;
      return buildPublicResultPayloadItem({
        assessmentId: assessment.id,
        assessmentName: assessment.name ?? 'Assessment',
        termName: assessment.term?.name ?? 'Unknown term',
        termId: assessment.term?.id ?? null,
        totalScore,
        caScore: result?.caScore ?? null,
        testScore: result?.testScore ?? null,
        examScore: result?.examScore ?? null,
        grade: getPublicGrade(totalScore) ?? null,
      });
    });

    const reportCards = await Promise.all(
      assessments.map(async (assessment) => {
        try {
          const reportCardData = await reportCardService.generateReportCard(assessment.id, pupil.id, school.id);
          return {
            assessmentId: assessment.id,
            ...reportCardData,
          };
        } catch (error) {
          console.error('Error generating public report card payload:', error);
          return null;
        }
      })
    );

    const hasPublishedResults = resultPayload.length > 0 || reportCards.some(Boolean);

    res.json({
      ok: true,
      requiresPin: false,
      message: hasPublishedResults ? null : 'No published results are available yet for this student.',
      school: {
        id: school.id,
        name: school.name,
        slug: school.slug,
        mode: school.resultAccessMode || 'NONE',
      },
      student: {
        id: pupil.id,
        firstName: pupil.firstName,
        lastName: pupil.lastName,
        admissionNo: pupil.admissionNo,
        className: pupil.class?.name ?? null,
      },
      results: resultPayload,
      reportCards: reportCards.filter(Boolean),
      term: assessments[0]?.term ?? null,
    });
  } catch (error) {
    console.error('Error checking public result access:', error);
    res.status(500).json({ error: 'Failed to check results' });
  }
});

export default router;
