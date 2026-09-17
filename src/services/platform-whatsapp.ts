import { platformBaileysSessionManager } from '../communications/platform-whatsapp-baileys.js';
import { PrismaClient } from '@prisma/client';

export const platformWhatsAppPrisma = new PrismaClient();

export type PlatformWhatsAppConnectionStatus = {
  connected: boolean;
  provider: string;
  status: string;
  statusMessage?: string;
  number: string | null;
  health: string;
  updatedAt: string | null;
  qr?: string;
  pairingCode?: string;
  pairingMethod?: string;
  lastError?: string;
  debugInfo?: Record<string, unknown>;
};

export type PlatformWhatsAppTemplate = {
  id: string;
  name: string;
  category: string;
  status: string;
  lastUpdated: string;
  message?: string;
};

export type PlatformWhatsAppCampaignStatus = 'draft' | 'queued' | 'approved' | 'sent' | 'failed';

export type PlatformWhatsAppCampaign = {
  id: string;
  name: string;
  audience: string;
  status: PlatformWhatsAppCampaignStatus;
  recipients: number;
  scheduled: string;
};

export type PlatformWhatsAppLog = {
  id: string;
  title: string;
  status: PlatformWhatsAppCampaignStatus | 'queued' | 'failed' | 'sent';
  time: string;
  details: string;
};

export type PlatformWhatsAppReadiness = {
  readyForStagedRollout: boolean;
  requiresManualApproval: boolean;
  blockedForMassBroadcast: boolean;
  warnings: string[];
  lastValidatedAt: string;
  checks: Record<string, boolean>;
};

export class PlatformWhatsAppService {
  private readonly prisma = platformWhatsAppPrisma;
  private accountId: string | null = null;
  private persistenceAvailable = true;
  private lastAccountSyncAt = 0;

  private readonly seedTemplates: PlatformWhatsAppTemplate[] = [
    {
      id: 'tpl-001',
      name: 'Onboarding guidance',
      category: 'Onboarding',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'Welcome to SchoolBase. We are excited to have your school on board and look forward to supporting your team as you begin this important setup journey.',
        '',
        'Our goal is to help you complete your configuration smoothly and begin using SchoolBase effectively across admissions, student records, attendance, timetable, fees, results, communication, and parent engagement. This is a critical step in creating more efficient operations and a more professional school experience for staff, parents, and students.',
        '',
        'To get started, please confirm your school profile, complete the core setup steps, add your staff and students, and prepare the modules your school will use first. Once your records and workflows are in place, your team will be able to move faster, reduce manual work, and create better visibility across the school.',
        '',
        'If you need guidance with any part of the setup, our team is ready to help. Please reply to this message or contact the SchoolBase support team and we will guide you through the process with care.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-002',
      name: 'How to set up timetable',
      category: 'Timetable',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'A well-structured timetable helps your school operate more smoothly, improves teacher coordination, and gives students a clearer academic rhythm. SchoolBase makes timetable planning simple, flexible, and easier to manage across classes, subjects, and staff assignments.',
        '',
        'To begin, open your timetable module and create the academic structure for each class, subject, and teacher. Review teacher availability, allocate periods intelligently, and confirm that each class has a realistic and balanced schedule. Once the timetable is in place, your school can reduce conflicts, improve accountability, and give staff a more organized way to work.',
        '',
        'We strongly recommend reviewing your timetable before the term begins or before major updates are rolled out. This helps ensure continuity, better planning, and a smoother experience for teachers and learners.',
        '',
        'If you need help setting up your timetable, please reply to this message and our support team will walk you through the process.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-003',
      name: 'School setup checklist',
      category: 'Setup',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'To help your school get the most out of SchoolBase, please complete the key setup steps in your dashboard. A strong foundation makes it easier for your team to manage admissions, fees, attendance, classes, results, communication, and school records with clarity and confidence.',
        '',
        'We recommend confirming your basic school profile, setting up your staff and classes, adding your students, publishing your fee structure, and activating the communication tools needed for parent engagement. Once these core items are in place, your school can begin operating in a more organized and efficient way.',
        '',
        'This setup phase is a very important investment in your school’s long-term productivity and professionalism. We are here to support you at every step so your school can launch with confidence.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-004',
      name: 'Product update',
      category: 'Product',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'SchoolBase is continuing to evolve to better support schools with more connected workflows, stronger communication, and a higher standard of operations management. We have recently improved the platform to help schools move faster, work more efficiently, and deliver a more professional experience to parents, staff, and students.',
        '',
        'These improvements include stronger communication tools, better fee and payment visibility, more refined administrative workflows, and a clearer, more usable school management experience. We are also continuing to strengthen features around timetable planning, results, report cards, and staff coordination so schools can manage the full academic cycle from one place.',
        '',
        'If your school is already using SchoolBase, we encourage you to log in and explore the latest tools available to your team. Reviewing your setup and workflows regularly helps your school unlock the full value of the platform.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-005',
      name: 'Pricing update',
      category: 'Billing',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'We are writing to share an important update to our SchoolBase pricing structure. This revision reflects the value of the platform’s continued growth and the broader set of tools now available to schools to support operations, communication, and long-term digital transformation.',
        '',
        'The updated pricing model is designed to better support schools at different stages of growth while continuing to invest in the features our customers rely on every day. This includes admissions, student records, attendance, fees, payments, timetable planning, results, report cards, parent communications, and school operations management.',
        '',
        'We remain committed to delivering value, reliability, and support to every school using SchoolBase. If you would like a tailored review of how this update affects your current plan, please reply to this message and our support team will be happy to assist you.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-006',
      name: 'Payment confirmation',
      category: 'Billing',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'We are pleased to confirm that your SchoolBase payment has been received successfully. Thank you for choosing SchoolBase to support your school’s operations and digital transformation journey.',
        '',
        'With SchoolBase, your school can manage student records, attendance, fees, results, parent communication, timetable planning, and day-to-day operations in a more organized and efficient way. Our goal is to make school administration simpler, clearer, and more effective for your full team.',
        '',
        'We are excited to continue supporting your school and look forward to helping you unlock the full value of the platform. If you need guidance on next steps or any support during setup, please contact the SchoolBase support team and we will be happy to assist.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-007',
      name: 'Support update',
      category: 'Support',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'This is an update on your SchoolBase support request. Our team is actively reviewing the matter and will provide the next step shortly so your school can continue operating smoothly and with confidence.',
        '',
        'We are taking the context of your account and school operations into consideration so we can resolve the issue efficiently and with the right level of support. Whether your needs relate to admissions, fees, timetable management, communication, or parent workflows, we are here to help.',
        '',
        'If there is any additional information you would like to share, please reply to this message and our team will continue from there.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-008',
      name: 'Best-practice guidance',
      category: 'Operations',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'To help your school get the most out of SchoolBase, we recommend using the platform consistently across admissions, student records, attendance, fees, payments, timetable planning, results, report cards, parent communication, and staff management. These workflows are designed to help schools improve visibility, reduce manual effort, and create a more accountable operating environment.',
        '',
        'A few practical ways to get the most value include keeping your timetable current, reviewing attendance and results regularly, sending timely fee reminders, using the parent portal consistently, and monitoring dashboards to stay informed. Small, consistent habits make a significant difference in school operations and communication quality.',
        '',
        'We are confident that a disciplined use of SchoolBase will help your school become more organized, more responsive, and more professional in the way it serves students and families.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-009',
      name: 'Manual announcement',
      category: 'Announcement',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'We have an important update for your school as part of our ongoing commitment to improving the SchoolBase experience. This message is intended to keep your team informed and prepared for the next stage of your school’s digital operations.',
        '',
        'Please review the information carefully and align your internal processes where needed. This update may affect how your team works with admissions, fees, timetable planning, communication, records, and reporting across the platform.',
        '',
        'If you need any guidance on how this change affects your school or daily operations, please reply to this message and our team will support you.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-010',
      name: 'Policy update',
      category: 'Policy',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'We are writing to share an important policy and compliance update for SchoolBase schools. This update helps ensure stronger data protection, better operational consistency, and a more secure experience across the platform.',
        '',
        'The updated practices affect how schools manage student information, staff access, reporting, communication, and operational records across admissions, attendance, fees, results, and parent engagement tools. Please review this update carefully and ensure your team understands the expectations and responsibilities involved.',
        '',
        'If you have questions or would like assistance understanding the implications for your school, please reply to this message and our team will be happy to guide you.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-011',
      name: 'Security notice',
      category: 'Security',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'The security of your school’s information remains a top priority at SchoolBase. We encourage all administrators to take a few simple but important steps to protect user accounts and maintain secure operations across the platform.',
        '',
        'Please review your passwords, access permissions, and account activity regularly, and make sure only authorized personnel have access to sensitive school information. This is especially important across admissions, student records, attendance, results, fees, and communication tools.',
        '',
        'If you need support reviewing your access settings or securing your SchoolBase account, please reply to this message and our team will be happy to assist.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-012',
      name: 'Account verification review',
      category: 'Compliance',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'Following a recent review of your SchoolBase account, we need to verify some of the registration information submitted during signup. Certain details appear to be incomplete, inconsistent, or not yet fully verifiable.',
        '',
        'As a precaution, access to your account has been temporarily suspended while this verification review is completed. This is a security and integrity measure and does not represent a final determination about your school.',
        '',
        'If your school is genuine and you would like to restore access, please reply to this message and our support team will guide you through the next steps. We may ask you to confirm or provide supporting information for the school and administrator account.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-013',
      name: 'Fee setup guide',
      category: 'Fees',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'A well-structured fee system is essential for financial clarity, parent communication, and school operations. SchoolBase gives your school a simple and professional way to define fee structures, publish payment expectations, and track collections in one place.',
        '',
        'To get started, please review your fee schedule, confirm the categories relevant to your school, and ensure parents have clear visibility into due dates and payment instructions. A clean and transparent fee process helps reduce confusion, improves cash flow, and strengthens trust with families.',
        '',
        'If you need help setting up your fee schedules or reviewing payment workflows, our support team is ready to assist.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-014',
      name: 'Parent portal rollout',
      category: 'Parent engagement',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'The SchoolBase Parent Portal is an important part of stronger school communication and better parent engagement. It gives families a clear way to stay informed about fees, attendance, results, announcements, and school updates in a secure and convenient environment.',
        '',
        'To get started, please ensure the parent access details are prepared and shared appropriately with families. Once active, the portal will make it easier for parents to stay connected to school activities and reduce communication gaps.',
        '',
        'Our team is happy to help you review or launch the parent portal in a way that fits your school’s process and communication style.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
    {
      id: 'tpl-015',
      name: 'Results and reports',
      category: 'Academic',
      status: 'approved',
      lastUpdated: 'Today',
      message: [
        'Hello {{schoolName}},',
        '',
        'SchoolBase helps schools manage academic performance more clearly, efficiently, and professionally. With the results and report-card workflows available in the platform, your school can organize assessment data, track student performance, and publish outcomes in a structured and transparent way.',
        '',
        'We encourage your team to review existing result templates, assessment settings, and publication workflows so reports can be generated quickly and shared confidently with parents and stakeholders. Clear academic reporting supports better planning, stronger communication, and a more informed school experience.',
        '',
        'If your school needs guidance on using the results or reporting features, please reply to this message and we will be glad to help.',
        '',
        'Warm regards,',
        'SchoolBase Support',
        'SchoolBase — Everything your school needs in one simple platform.',
        'Website: https://schoolbase.live',
        'Need help? Reply to this message or contact the SchoolBase support team.',
      ].join('\n'),
    },
  ];

  private readonly seedCampaigns: PlatformWhatsAppCampaign[] = [];

  private readonly templateStore: PlatformWhatsAppTemplate[] = [...this.seedTemplates];
  private readonly seedLogs: PlatformWhatsAppLog[] = [
    { id: 'log-001', title: 'Platform WhatsApp ready', status: 'queued', time: 'Just now', details: 'Session is active and awaiting review.' },
    { id: 'log-002', title: 'School outreach policy enabled', status: 'sent', time: 'Today', details: 'Manual approval is required before dispatch.' },
  ];
  private campaignStore: PlatformWhatsAppCampaign[] = [...this.seedCampaigns];
  private logStore: PlatformWhatsAppLog[] = [...this.seedLogs];

  private async ensurePersistentAccount(): Promise<string | null> {
    if (!this.persistenceAvailable) return null;
    if (this.accountId) return this.accountId;

    try {
      const account = await this.prisma.platformWhatsAppAccount.findFirst({
        where: { status: { in: ['ACTIVE', 'DISCONNECTED', 'ERROR'] } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });

      if (account) {
        this.accountId = account.id;
        return account.id;
      }

      const created = await this.prisma.platformWhatsAppAccount.create({
        data: {
          displayName: 'SchoolBase Platform WhatsApp',
          provider: 'BAILEYS',
          status: 'DISCONNECTED',
        },
        select: { id: true },
      });
      this.accountId = created.id;
      return created.id;
    } catch (error) {
      this.persistenceAvailable = false;
      console.warn('[platform-whatsapp] Persistence unavailable; using in-memory fallback.', error);
      return null;
    }
  }

  private async ensurePersistentTemplates(accountId: string): Promise<void> {
    const existingCount = await this.prisma.platformWhatsAppTemplate.count({ where: { accountId } });
    if (existingCount > 0) return;

    await this.prisma.platformWhatsAppTemplate.createMany({
      data: this.seedTemplates.map((template) => ({
        accountId,
        name: template.name,
        category: template.category,
        status: template.status.toUpperCase(),
        body: template.message || '',
        language: 'en',
      })),
    });
  }

  async getOverview(): Promise<{
    connected: boolean;
    provider: string;
    status: string;
    number: string | null;
    sentThisWeek: number;
    failedThisWeek: number;
    templates: number;
    health: string;
    updatedAt: string | null;
    pendingCampaigns: number;
    queued: number;
    approved: number;
  }> {
    const session = platformBaileysSessionManager.getStatus();
    await this.syncAccountStatus({
      connected: session.connected,
      phoneNumber: session.phoneNumber,
      lastError: session.lastError,
    });

    return {
      connected: session.connected,
      provider: session.provider,
      status: session.status,
      number: session.phoneNumber,
      sentThisWeek: 0,
      failedThisWeek: 0,
      templates: this.seedTemplates.length,
      health: session.health,
      updatedAt: session.updatedAt,
      pendingCampaigns: this.campaignStore.filter((campaign) => campaign.status === 'draft').length,
      queued: this.campaignStore.filter((campaign) => campaign.status === 'queued').length,
      approved: this.campaignStore.filter((campaign) => campaign.status === 'approved').length,
    };
  }

  async getStatus(): Promise<PlatformWhatsAppConnectionStatus> {
    const session = platformBaileysSessionManager.getStatus();
    await this.syncAccountStatus({
      connected: session.connected,
      phoneNumber: session.phoneNumber,
      lastError: session.lastError,
    });

    return {
      connected: session.connected,
      provider: session.provider,
      status: session.status,
      statusMessage: session.statusMessage,
      number: session.phoneNumber,
      health: session.health,
      updatedAt: session.updatedAt,
      qr: session.qr,
      pairingCode: session.pairingCode,
      pairingMethod: session.pairingMethod,
      lastError: session.lastError,
      debugInfo: session.debugInfo,
    };
  }

  async syncAccountStatus(status: { connected: boolean; phoneNumber?: string | null; lastError?: string }, force = false): Promise<void> {
    const accountId = await this.ensurePersistentAccount();
    if (!accountId) return;

    const now = Date.now();
    if (!force && now - this.lastAccountSyncAt < 30_000) return;
    this.lastAccountSyncAt = now;

    try {
      const currentAccount = await this.prisma.platformWhatsAppAccount.findUnique({
        where: { id: accountId },
        select: { status: true },
      });
      const nextStatus = status.lastError ? 'ERROR' : status.connected ? 'ACTIVE' : 'DISCONNECTED';
      await this.prisma.platformWhatsAppAccount.update({
        where: { id: accountId },
        data: {
          status: nextStatus,
          phoneNumber: status.phoneNumber || undefined,
          connectedAt: status.connected && currentAccount?.status !== 'ACTIVE' ? new Date() : undefined,
          disconnectedAt: !status.connected && currentAccount?.status !== 'DISCONNECTED' ? new Date() : undefined,
          lastHealthCheckAt: new Date(),
          lastError: status.lastError || null,
        },
      });
    } catch (error) {
      console.warn('[platform-whatsapp] Could not sync platform account status.', error);
    }
  }

  async getTemplates(): Promise<PlatformWhatsAppTemplate[]> {
    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      try {
        await this.ensurePersistentTemplates(accountId);
        const templates = await this.prisma.platformWhatsAppTemplate.findMany({
          where: { accountId },
          orderBy: { updatedAt: 'desc' },
        });
        return templates.map((template) => ({
          id: template.id,
          name: template.name,
          category: template.category,
          status: template.status.toLowerCase(),
          lastUpdated: template.updatedAt.toISOString(),
          message: template.body,
        }));
      } catch (error) {
        this.persistenceAvailable = false;
        console.warn('[platform-whatsapp] Template persistence failed; using in-memory fallback.', error);
      }
    }
    return this.templateStore;
  }

  async resolveSchoolRecipients(
    schoolIds: Array<string | null | undefined> = [],
    schoolRecords: Array<{ id: string; phone?: string | null }> = [],
  ): Promise<string[]> {
    const phoneById = new Map<string, string>();
    for (const school of schoolRecords) {
      const normalizedPhone = String(school.phone || '').trim();
      if (school.id && normalizedPhone) {
        phoneById.set(school.id, normalizedPhone);
      }
    }

    const resolved: string[] = [];
    const seen = new Set<string>();

    for (const schoolId of schoolIds) {
      const normalizedSchoolId = String(schoolId || '').trim();
      if (!normalizedSchoolId) continue;

      const phone = phoneById.get(normalizedSchoolId);
      if (!phone) continue;

      const uniquePhone = phone.trim();
      if (!uniquePhone || seen.has(uniquePhone)) continue;
      seen.add(uniquePhone);
      resolved.push(uniquePhone);
    }

    return resolved;
  }

  async createTemplate(payload: { name?: string; category?: string; status?: string; message?: string } = {}): Promise<PlatformWhatsAppTemplate> {
    const name = String(payload.name || 'New platform template').trim();
    const category = String(payload.category || 'General').trim();
    const template: PlatformWhatsAppTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      category,
      status: String(payload.status || 'draft'),
      lastUpdated: 'Now',
      message: payload.message || 'Hello {{schoolName}}, this is a platform message from SchoolBase.',
    };

    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      try {
        const saved = await this.prisma.platformWhatsAppTemplate.create({
          data: {
            accountId,
            name,
            category,
            status: template.status.toUpperCase(),
            body: template.message || '',
            language: 'en',
          },
        });
        return {
          id: saved.id,
          name: saved.name,
          category: saved.category,
          status: saved.status.toLowerCase(),
          lastUpdated: saved.updatedAt.toISOString(),
          message: saved.body,
        };
      } catch (error) {
        this.persistenceAvailable = false;
        console.warn('[platform-whatsapp] Template persistence failed; using in-memory fallback.', error);
      }
    }

    this.templateStore.unshift(template);
    return template;
  }

  async previewCampaign(payload: {
    audience?: string;
    templateId?: string;
    message?: string;
    schoolCount?: number;
  } = {}): Promise<{
    audience: string;
    estimatedRecipients: number;
    templateName?: string;
    summary: string;
  }> {
    const audience = payload.audience || 'All schools';
    const template = (await this.getTemplates()).find((item) => item.id === payload.templateId) || null;
    const estimatedRecipients = Number(payload.schoolCount ?? 0);

    return {
      audience,
      estimatedRecipients,
      templateName: template?.name,
      summary: estimatedRecipients
        ? `${estimatedRecipients} schools will receive the selected message. Review the template and audience before sending.`
        : `The selected audience has not been calculated yet. Review the audience and message before final approval.`,
    };
  }

  async createCampaign(payload: {
    name?: string;
    audience?: string;
    templateId?: string;
    message?: string;
    scheduled?: string;
    schoolCount?: number;
    recipients?: Array<{ schoolId: string; recipientName: string; phoneNumber: string }>;
  } = {}): Promise<PlatformWhatsAppCampaign> {
    const selectedTemplate = (await this.getTemplates()).find((item) => item.id === payload.templateId) || null;
    const audience = payload.audience || 'All schools';
    const preview = await this.previewCampaign({
      audience,
      templateId: selectedTemplate?.id,
      message: payload.message,
      schoolCount: payload.schoolCount,
    });
    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      try {
        const saved = await this.prisma.platformWhatsAppCampaign.create({
          data: {
            accountId,
            templateId: selectedTemplate?.id,
            name: payload.name || selectedTemplate?.name || 'Platform campaign',
            audienceType: 'SCHOOL_FILTER',
            audienceFilter: JSON.stringify({ audience, message: payload.message || selectedTemplate?.message || '' }),
            status: 'QUEUED',
            recipientsCount: preview.estimatedRecipients,
            scheduledAt: payload.scheduled && !Number.isNaN(Date.parse(payload.scheduled))
              ? new Date(payload.scheduled)
              : null,
            recipients: payload.recipients?.length
              ? { create: payload.recipients }
              : undefined,
          },
        });
        return {
          id: saved.id,
          name: saved.name,
          audience,
          status: saved.status.toLowerCase() as PlatformWhatsAppCampaignStatus,
          recipients: saved.recipientsCount,
          scheduled: saved.scheduledAt?.toISOString() || payload.scheduled || 'Queued for review',
        };
      } catch (error) {
        this.persistenceAvailable = false;
        console.warn('[platform-whatsapp] Campaign persistence failed; using in-memory fallback.', error);
      }
    }

    const campaign: PlatformWhatsAppCampaign = {
      id: `camp-${Date.now()}`,
      name: payload.name || selectedTemplate?.name || 'Platform campaign',
      audience,
      status: 'queued',
      recipients: preview.estimatedRecipients,
      scheduled: payload.scheduled || 'Queued for review',
    };

    this.campaignStore.unshift(campaign);
    return campaign;
  }

  async getCampaigns(): Promise<PlatformWhatsAppCampaign[]> {
    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      try {
        const campaigns = await this.prisma.platformWhatsAppCampaign.findMany({
          where: { accountId },
          orderBy: { createdAt: 'desc' },
        });
        return campaigns.map((campaign) => {
          let audience = 'All schools';
          try {
            audience = JSON.parse(campaign.audienceFilter || '{}')?.audience || audience;
          } catch {
            // Preserve the default audience for legacy or malformed filters.
          }
          return {
            id: campaign.id,
            name: campaign.name,
            audience,
            status: campaign.status.toLowerCase() as PlatformWhatsAppCampaignStatus,
            recipients: campaign.recipientsCount,
            scheduled: campaign.scheduledAt?.toISOString() || 'Queued for review',
          };
        });
      } catch (error) {
        this.persistenceAvailable = false;
        console.warn('[platform-whatsapp] Campaign persistence failed; using in-memory fallback.', error);
      }
    }
    return this.campaignStore;
  }

  async updateCampaignStatus(campaignId: string, status: PlatformWhatsAppCampaignStatus): Promise<PlatformWhatsAppCampaign | null> {
    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      try {
        const saved = await this.prisma.platformWhatsAppCampaign.updateMany({
          where: { id: campaignId, accountId },
          data: { status: status.toUpperCase() },
        });
        if (saved.count > 0) {
          const campaigns = await this.getCampaigns();
          return campaigns.find((campaign) => campaign.id === campaignId) || null;
        }
      } catch (error) {
        this.persistenceAvailable = false;
        console.warn('[platform-whatsapp] Campaign status persistence failed; using in-memory fallback.', error);
      }
    }

    const campaign = this.campaignStore.find((item) => item.id === campaignId);
    if (!campaign) return null;

    campaign.status = status;
    if (status === 'queued') {
      campaign.scheduled = 'Queued for approval';
    } else if (status === 'approved') {
      campaign.scheduled = 'Approved and ready';
    } else if (status === 'sent') {
      campaign.scheduled = 'Sent now';
    } else if (status === 'failed') {
      campaign.scheduled = 'Needs review';
    }

    const actionLabel = status === 'queued' ? 'queued' : status === 'approved' ? 'approved' : status === 'sent' ? 'sent' : 'needs review';
    this.logStore.unshift({
      id: `log-${Date.now()}`,
      title: `${campaign.name} ${actionLabel}`,
      status,
      time: 'Just now',
      details: `Campaign status updated to ${status}.`,
    });

    return campaign;
  }

  async sendCampaign(campaignId: string): Promise<PlatformWhatsAppCampaign | null> {
    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      const campaign = await this.prisma.platformWhatsAppCampaign.findFirst({
        where: { id: campaignId, accountId },
        include: { recipients: true },
      });
      if (!campaign) return null;
      if (campaign.status !== 'APPROVED') {
        throw new Error('Campaign must be approved before it can be sent.');
      }

      let message = '';
      try {
        message = JSON.parse(campaign.audienceFilter || '{}')?.message || '';
      } catch {
        message = '';
      }
      if (!message.trim()) {
        throw new Error('Campaign message is missing. Create the campaign again with a message.');
      }

      for (const recipient of campaign.recipients) {
        const slotAvailable = await platformBaileysSessionManager.waitForNextSendSlot();
        if (!slotAvailable) {
          await this.prisma.platformWhatsAppCampaignRecipient.update({
            where: { id: recipient.id },
            data: { status: 'FAILED', lastError: 'Platform WhatsApp send limit reached.' },
          });
          continue;
        }

        const renderedMessage = message.replace(/\{\{\s*schoolName\s*\}\}/g, recipient.recipientName || 'School');
        const result = await platformBaileysSessionManager.sendTextMessage(recipient.phoneNumber, renderedMessage);
        await this.prisma.platformWhatsAppCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: result.success ? 'SENT' : 'FAILED',
            deliveredAt: result.success ? new Date() : null,
            lastError: result.error,
          },
        });
        await this.prisma.platformWhatsAppMessageLog.create({
          data: {
            accountId,
            campaignId,
            schoolId: recipient.schoolId,
            recipientName: recipient.recipientName,
            recipientPhone: recipient.phoneNumber,
            contentPreview: renderedMessage.slice(0, 500),
            status: result.success ? 'SENT' : 'FAILED',
            providerMessageId: result.messageId,
            lastError: result.error,
          },
        });
      }

      const failedCount = await this.prisma.platformWhatsAppCampaignRecipient.count({
        where: { campaignId, status: 'FAILED' },
      });
      await this.prisma.platformWhatsAppCampaign.update({
        where: { id: campaignId },
        data: {
          status: failedCount ? 'FAILED' : 'SENT',
          sentAt: new Date(),
          lastError: failedCount ? `${failedCount} recipient(s) failed.` : null,
        },
      });
      const campaigns = await this.getCampaigns();
      return campaigns.find((item) => item.id === campaignId) || null;
    }

    const campaign = this.campaignStore.find((item) => item.id === campaignId);
    if (!campaign) return null;
    if (campaign.status !== 'approved') {
      throw new Error('Campaign must be approved before it can be sent.');
    }

    campaign.status = 'failed';
    campaign.scheduled = 'Delivery unavailable';
    this.logStore.unshift({
      id: `log-${Date.now()}`,
      title: `${campaign.name} delivery unavailable`,
      status: 'failed',
      time: 'Just now',
      details: 'Campaign persistence is not available, so no messages were sent.',
    });

    return campaign;
  }

  async getLogs(): Promise<PlatformWhatsAppLog[]> {
    const accountId = await this.ensurePersistentAccount();
    if (accountId) {
      try {
        const logs = await this.prisma.platformWhatsAppMessageLog.findMany({
          where: { accountId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });
        return logs.map((log) => ({
          id: log.id,
          title: `${log.direction === 'OUTBOUND' ? 'Message to' : 'Reply from'} ${log.recipientName || log.recipientPhone}`,
          status: log.status.toLowerCase() as PlatformWhatsAppLog['status'],
          time: log.createdAt.toISOString(),
          details: log.lastError || log.contentPreview || 'Platform WhatsApp message recorded.',
        }));
      } catch (error) {
        console.warn('[platform-whatsapp] Message log persistence unavailable; using in-memory fallback.', error);
      }
    }
    return this.logStore;
  }

  async getReadiness(): Promise<PlatformWhatsAppReadiness> {
    const status = platformBaileysSessionManager.getStatus();
    const checks = {
      isolatedSession: status.sessionNamespace === 'platform-admin',
      connectionConfigured: status.connected || status.status === 'connecting' || status.status === 'qr',
      audienceFiltering: true,
      manualApprovalRequired: true,
      logsAvailable: this.logStore.length > 0,
      templateReviewEnabled: this.templateStore.length > 0,
      deliveryWebhookMonitoring: false,
      suppressionChecks: false,
    };

    const warnings = [
      'Manual approval is required for every outgoing platform campaign.',
      'This rollout is limited to admin-reviewed sends and is not a mass-broadcast system.',
    ];

    if (!checks.connectionConfigured) {
      warnings.push('Platform WhatsApp is not connected yet; connect the Baileys session before live sending.');
    }

    if (!checks.deliveryWebhookMonitoring) {
      warnings.push('Webhook delivery confirmation and retry status tracking are still pending for full production automation.');
    }

    if (!checks.suppressionChecks) {
      warnings.push('Recipient suppression, opt-in, and quiet-hours enforcement are still active safeguards.');
    }

    return {
      readyForStagedRollout: Boolean(status.connected || status.status === 'connecting' || status.status === 'qr'),
      requiresManualApproval: true,
      blockedForMassBroadcast: true,
      warnings,
      lastValidatedAt: new Date().toISOString(),
      checks,
    };
  }
}

export const platformWhatsAppService = new PlatformWhatsAppService();
