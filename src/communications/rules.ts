export interface CommunicationRuleDefinition {
  enabled: boolean;
  channels: Array<'EMAIL' | 'WHATSAPP'>;
  template: string;
}

export class CommunicationRulesRegistry {
  private readonly perSchoolRules = new Map<string, Record<string, CommunicationRuleDefinition>>();

  constructor(private readonly defaults: Record<string, CommunicationRuleDefinition> = DEFAULT_COMMUNICATION_RULES) {}

  getRules(schoolId: string): Record<string, CommunicationRuleDefinition> {
    const normalizedSchoolId = sanitizeSchoolId(schoolId);
    const existing = this.perSchoolRules.get(normalizedSchoolId);
    if (existing) {
      return Object.fromEntries(
        Object.entries(existing).map(([event, rule]) => [event, { ...rule }])
      );
    }

    const clonedDefaults = Object.fromEntries(
      Object.entries(this.defaults).map(([event, rule]) => [event, { ...rule }])
    ) as Record<string, CommunicationRuleDefinition>;
    this.perSchoolRules.set(normalizedSchoolId, clonedDefaults);
    return clonedDefaults;
  }

  setRuleEnabled(schoolId: string, event: string, enabled: boolean) {
    const rules = this.getRules(schoolId);
    const rule = rules[event];
    if (!rule) {
      return;
    }

    rule.enabled = enabled;
    this.perSchoolRules.set(sanitizeSchoolId(schoolId), rules);
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
  AdmissionCreated: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Admission' },
  AnnouncementCreated: { enabled: true, channels: ['EMAIL', 'WHATSAPP'], template: 'Announcement' },
};

function sanitizeSchoolId(schoolId: string): string {
  return String(schoolId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export default CommunicationRulesRegistry;
