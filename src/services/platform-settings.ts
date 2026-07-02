import { PrismaClient } from '@prisma/client';

export const platformSettingDefaults = {
  maintenanceMode: false,
  allowSignup: true,
  allowTrial: true,
  autoApproveSchools: false,
  supportEmail: 'support@schoolbase.live',
};

export function serializePlatformSettingValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    console.warn('Failed to serialize platform setting value, storing as string', error);
    return String(value);
  }
}

export function parsePlatformSettingValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function getPlatformSettings(prisma: PrismaClient) {
  const entries = await prisma.platformSetting.findMany({ select: { key: true, value: true } });

  const settings = Object.fromEntries(
    entries.map((entry) => [entry.key, parsePlatformSettingValue(entry.value)])
  );

  return {
    ...platformSettingDefaults,
    ...settings,
  } as Record<string, unknown>;
}

export async function getPlatformSettingValue<T>(
  prisma: PrismaClient,
  key: string,
  defaultValue: T
): Promise<T> {
  const entry = await prisma.platformSetting.findUnique({ where: { key } });
  if (!entry) {
    return defaultValue;
  }

  const parsed = parsePlatformSettingValue(entry.value);
  return (parsed as T) ?? defaultValue;
}
