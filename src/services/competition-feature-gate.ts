import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  competitionFeatureDefaults,
  competitionFeatureKeys,
  type CompetitionFeatureKey,
  getPlatformSettingValue,
} from './platform-settings.js';

export function normalizeCompetitionFeatures(value: unknown): Record<CompetitionFeatureKey, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...competitionFeatureDefaults };
  }

  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    competitionFeatureKeys.map((key) => [key, input[key] === true]),
  ) as Record<CompetitionFeatureKey, boolean>;
}

export function isCompetitionFeatureEnabled(
  features: Record<CompetitionFeatureKey, boolean>,
  key: CompetitionFeatureKey,
): boolean {
  if (key === 'competition.enabled') return features[key];
  return features['competition.enabled'] === true && features[key] === true;
}

export async function resolveCompetitionFeature(
  prisma: PrismaClient,
  key: CompetitionFeatureKey,
): Promise<boolean> {
  try {
    const stored = await getPlatformSettingValue<unknown>(
      prisma,
      'competitionFeatures',
      competitionFeatureDefaults,
    );
    return isCompetitionFeatureEnabled(normalizeCompetitionFeatures(stored), key);
  } catch {
    return false;
  }
}

export function requireCompetitionFeature(prisma: PrismaClient, key: CompetitionFeatureKey) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    if (!(await resolveCompetitionFeature(prisma, key))) {
      res.status(404).json({ message: 'This Competition feature is not available.' });
      return;
    }
    next();
  };
}