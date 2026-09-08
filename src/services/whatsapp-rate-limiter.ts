export interface SchoolWhatsAppRateLimitConfig {
  minIntervalMs?: number;
  perMinuteLimit?: number;
  perHourLimit?: number;
  perDayLimit?: number;
}

interface RateBucketState {
  lastSentAt: number;
  minuteWindow: number[];
  hourWindow: number[];
  dayWindow: number[];
}

export class SchoolWhatsAppRateLimiter {
  private readonly schools = new Map<string, RateBucketState>();
  private readonly config: Required<SchoolWhatsAppRateLimitConfig>;

  constructor(config: SchoolWhatsAppRateLimitConfig = {}) {
    this.config = {
      minIntervalMs: config.minIntervalMs ?? 3000,
      perMinuteLimit: config.perMinuteLimit ?? 10,
      perHourLimit: config.perHourLimit ?? 100,
      perDayLimit: config.perDayLimit ?? 300,
    };
  }

  async tryAcquire(schoolId: string): Promise<boolean> {
    const normalizedSchoolId = String(schoolId || '').trim();
    if (!normalizedSchoolId) {
      return false;
    }

    const now = Date.now();
    const current = this.schools.get(normalizedSchoolId) ?? {
      lastSentAt: 0,
      minuteWindow: [],
      hourWindow: [],
      dayWindow: [],
    };

    this.pruneWindow(current.minuteWindow, now - 60_000);
    this.pruneWindow(current.hourWindow, now - 3_600_000);
    this.pruneWindow(current.dayWindow, now - 86_400_000);

    const minIntervalSatisfied = current.lastSentAt === 0 || now - current.lastSentAt >= this.config.minIntervalMs;
    const minuteAllowed = current.minuteWindow.length < this.config.perMinuteLimit;
    const hourAllowed = current.hourWindow.length < this.config.perHourLimit;
    const dayAllowed = current.dayWindow.length < this.config.perDayLimit;

    if (!minIntervalSatisfied || !minuteAllowed || !hourAllowed || !dayAllowed) {
      return false;
    }

    current.lastSentAt = now;
    current.minuteWindow.push(now);
    current.hourWindow.push(now);
    current.dayWindow.push(now);
    this.schools.set(normalizedSchoolId, current);
    return true;
  }

  async waitForNextSlot(schoolId: string): Promise<boolean> {
    const normalizedSchoolId = String(schoolId || '').trim();
    if (!normalizedSchoolId) return false;

    const current = this.schools.get(normalizedSchoolId);
    if (!current) return true;

    const now = Date.now();
    this.pruneWindow(current.minuteWindow, now - 60_000);
    this.pruneWindow(current.hourWindow, now - 3_600_000);
    this.pruneWindow(current.dayWindow, now - 86_400_000);

    if (
      current.minuteWindow.length >= this.config.perMinuteLimit ||
      current.hourWindow.length >= this.config.perHourLimit ||
      current.dayWindow.length >= this.config.perDayLimit
    ) {
      return false;
    }

    const waitMs = Math.max(0, this.config.minIntervalMs - (now - current.lastSentAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return true;
  }

  getSchoolState(schoolId: string): { lastSentAt: number; minuteCount: number; hourCount: number; dayCount: number } {
    const normalizedSchoolId = String(schoolId || '').trim();
    const current = this.schools.get(normalizedSchoolId);
    if (!current) {
      return { lastSentAt: 0, minuteCount: 0, hourCount: 0, dayCount: 0 };
    }

    return {
      lastSentAt: current.lastSentAt,
      minuteCount: current.minuteWindow.length,
      hourCount: current.hourWindow.length,
      dayCount: current.dayWindow.length,
    };
  }

  private pruneWindow(window: number[], cutoffMs: number) {
    const index = window.findIndex((timestamp) => timestamp >= cutoffMs);
    if (index === -1) {
      window.length = 0;
      return;
    }
    window.splice(0, index);
  }
}

export const schoolWhatsAppRateLimiter = new SchoolWhatsAppRateLimiter();
