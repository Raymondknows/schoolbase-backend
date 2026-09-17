import { platformBaileysSessionManager } from '../communications/platform-whatsapp-baileys.js';

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
  private readonly seedTemplates: PlatformWhatsAppTemplate[] = [
    {
      id: 'tpl-001',
      name: 'New school onboarding',
      category: 'Onboarding',
      status: 'approved',
      lastUpdated: 'Today',
      message: 'Hello {{schoolName}}, welcome to SchoolBase. Your onboarding is almost ready. Please complete the final setup steps so your school can start using the platform quickly.',
    },
    {
      id: 'tpl-002',
      name: 'Trial reminder',
      category: 'Retention',
      status: 'approved',
      lastUpdated: 'Yesterday',
      message: 'Hello {{schoolName}}, your SchoolBase trial is nearing its end. We would love to help you complete setup and continue with the platform without disruption.',
    },
    {
      id: 'tpl-003',
      name: 'Renewal reminder',
      category: 'Billing',
      status: 'approved',
      lastUpdated: '2 days ago',
      message: 'Hello {{schoolName}}, your SchoolBase subscription is due for renewal. Please confirm your plan so your school can continue using the platform without interruption.',
    },
  ];

  private readonly seedCampaigns: PlatformWhatsAppCampaign[] = [
    { id: 'camp-001', name: 'Trial follow-up', audience: 'Trial schools', status: 'draft', recipients: 18, scheduled: 'Not scheduled' },
    { id: 'camp-002', name: 'Onboarding reminder', audience: 'Incomplete setups', status: 'approved', recipients: 32, scheduled: 'Tomorrow' },
    { id: 'camp-003', name: 'Monthly renewal push', audience: 'Active paying schools', status: 'queued', recipients: 54, scheduled: 'This Friday' },
  ];

  private readonly templateStore: PlatformWhatsAppTemplate[] = [...this.seedTemplates];
  private readonly seedLogs: PlatformWhatsAppLog[] = [
    { id: 'log-001', title: 'Trial reminder campaign reviewed', status: 'queued', time: '10 mins ago', details: 'Awaiting approval before sending.' },
    { id: 'log-002', title: 'School signup follow-up failed', status: 'failed', time: '2 hours ago', details: 'Number was missing or invalid for 3 schools.' },
    { id: 'log-003', title: 'Monthly announcement sent', status: 'sent', time: 'Yesterday', details: 'Delivered to 41 relevant recipients.' },
  ];
  private campaignStore: PlatformWhatsAppCampaign[] = [...this.seedCampaigns];
  private logStore: PlatformWhatsAppLog[] = [...this.seedLogs];

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

  async getTemplates(): Promise<PlatformWhatsAppTemplate[]> {
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
    const template = this.templateStore.find((item) => item.id === payload.templateId) || null;
    const estimatedRecipients = payload.schoolCount ?? (
      audience === 'Trial schools' ? 18 :
      audience === 'Incomplete setups' ? 32 :
      audience === 'Expiring schools' ? 24 :
      audience === 'Renewal reminders' ? 41 :
      26
    );

    return {
      audience,
      estimatedRecipients,
      templateName: template?.name,
      summary: `${estimatedRecipients} schools will receive the selected message. Review the template and audience before sending.`,
    };
  }

  async createCampaign(payload: {
    name?: string;
    audience?: string;
    templateId?: string;
    message?: string;
    scheduled?: string;
  } = {}): Promise<PlatformWhatsAppCampaign> {
    const selectedTemplate = this.templateStore.find((item) => item.id === payload.templateId) || null;
    const audience = payload.audience || 'All schools';
    const preview = await this.previewCampaign({ audience, templateId: selectedTemplate?.id, message: payload.message });
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
    return this.campaignStore;
  }

  async updateCampaignStatus(campaignId: string, status: PlatformWhatsAppCampaignStatus): Promise<PlatformWhatsAppCampaign | null> {
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
    const campaign = this.campaignStore.find((item) => item.id === campaignId);
    if (!campaign) return null;

    campaign.status = 'sent';
    campaign.scheduled = 'Sent now';
    this.logStore.unshift({
      id: `log-${Date.now()}`,
      title: `${campaign.name} sent`,
      status: 'sent',
      time: 'Just now',
      details: `Delivery started for ${campaign.recipients} recipients.`,
    });

    return campaign;
  }

  async getLogs(): Promise<PlatformWhatsAppLog[]> {
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
