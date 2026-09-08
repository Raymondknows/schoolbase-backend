import { PrismaClient } from '@prisma/client';

export interface CommunicationRuleDefinition {
  enabled: boolean;
  channels: Array<'EMAIL' | 'WHATSAPP'>;
  template: string;
}

export interface SchoolWhatsAppPolicyRecord {
  schoolId: string;
  enabled: boolean;
  messagesPerMinute: number;
  messagesPerHour: number;
  messagesPerDay: number;
  batchSize: number;
  batchCooldownSeconds: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  requireApprovalForBulk: boolean;
  allowAutomaticRetries: boolean;
  timezone: string;
  updatedAt: Date;
}

export class CommunicationRulesRegistry {
  private readonly perSchoolRules = new Map<string, Record<string, CommunicationRuleDefinition>>();

  constructor(
    private readonly defaults: Record<string, CommunicationRuleDefinition> = DEFAULT_COMMUNICATION_RULES,
    private readonly prisma?: PrismaClient,
  ) {}

  private cloneDefaults() {
    return Object.fromEntries(
      Object.entries(this.defaults).map(([event, rule]) => [event, { ...rule, channels: [...rule.channels] }])
    ) as Record<string, CommunicationRuleDefinition>;
  }

  async loadRules(schoolId: string): Promise<Record<string, CommunicationRuleDefinition>> {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const rules = this.cloneDefaults();

    if (this.prisma) {
      const storedRules = await this.prisma.communicationRule.findMany({ where: { schoolId } });
      for (const storedRule of storedRules) {
        rules[storedRule.event] = {
          enabled: storedRule.enabled,
          channels: storedRule.channels.split(',').filter(Boolean) as CommunicationRuleDefinition['channels'],
          template: storedRule.template,
        };
      }
    }

    this.perSchoolRules.set(normalizedSchoolId, rules);
    return Object.fromEntries(Object.entries(rules).map(([event, rule]) => [event, { ...rule, channels: [...rule.channels] }]));
  }

  getRules(schoolId: string): Record<string, CommunicationRuleDefinition> {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const existing = this.perSchoolRules.get(normalizedSchoolId);
    if (existing) {
      return Object.fromEntries(
        Object.entries(existing).map(([event, rule]) => [event, { ...rule }])
      );
    }

    const clonedDefaults = this.cloneDefaults();
    this.perSchoolRules.set(normalizedSchoolId, clonedDefaults);
    return clonedDefaults;
  }

  async setRuleEnabled(schoolId: string, event: string, enabled: boolean) {
    const rules = this.getRules(schoolId);
    const rule = rules[event];
    if (!rule) {
      return;
    }

    rule.enabled = enabled;
    this.perSchoolRules.set(sanitizeSchoolId(schoolId), rules);

    if (this.prisma) {
      await this.prisma.communicationRule.upsert({
        where: { schoolId_event: { schoolId, event } },
        create: { schoolId, event, enabled, channels: rule.channels.join(','), template: rule.template },
        update: { enabled, channels: rule.channels.join(','), template: rule.template },
      });
    }
  }

  isEnabled(schoolId: string, event: string): boolean {
    return this.getRules(schoolId)[event]?.enabled ?? false;
  }
}

export const DEFAULT_COMMUNICATION_RULES: Record<string, CommunicationRuleDefinition> = {
  FeeInvoiceCreated: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Invoice' },
  FeeReminder: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'FeeReminder' },
  FeePaymentReceived: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Receipt' },
  AttendanceMarked: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Attendance' },
  ResultsPublished: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Results' },
  PinDelivered: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Results' },
  AdmissionCreated: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Admission' },
  AnnouncementCreated: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Announcement' },
};

export function getDefaultWhatsAppPolicyRecord(schoolId: string): SchoolWhatsAppPolicyRecord {
  return {
    schoolId: String(schoolId || '').trim() || 'default-school',
    enabled: true,
    messagesPerMinute: 10,
    messagesPerHour: 100,
    messagesPerDay: 300,
    batchSize: 25,
    batchCooldownSeconds: 120,
    quietHoursStart: '21:00',
    quietHoursEnd: '07:00',
    requireApprovalForBulk: true,
    allowAutomaticRetries: true,
    timezone: 'Africa/Lagos',
    updatedAt: new Date(),
  };
}

function sanitizeSchoolId(schoolId: string): string {
  return String(schoolId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export default CommunicationRulesRegistry;
