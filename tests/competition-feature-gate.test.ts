import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  isCompetitionFeatureEnabled,
  normalizeCompetitionFeatures,
  resolveCompetitionFeature,
} from '../src/services/competition-feature-gate.js';
import { competitionFeatureDefaults } from '../src/services/platform-settings.js';

function prismaWithSetting(value?: string, shouldThrow = false) {
  return {
    platformSetting: {
      findUnique: async () => {
        if (shouldThrow) throw new Error('settings unavailable');
        return value === undefined ? null : { key: 'competitionFeatures', value };
      },
    },
  } as unknown as PrismaClient;
}

const defaultFeatures = normalizeCompetitionFeatures(undefined);
assert.deepEqual(defaultFeatures, competitionFeatureDefaults);
assert.equal(isCompetitionFeatureEnabled(defaultFeatures, 'competition.enabled'), false);
assert.equal(isCompetitionFeatureEnabled(defaultFeatures, 'competition.dailyChallenge.enabled'), false);

const childEnabledOnly = normalizeCompetitionFeatures({ 'competition.dailyChallenge.enabled': true });
assert.equal(isCompetitionFeatureEnabled(childEnabledOnly, 'competition.dailyChallenge.enabled'), false);

const enabledFeatures = normalizeCompetitionFeatures({
  'competition.enabled': true,
  'competition.dailyChallenge.enabled': true,
});
assert.equal(isCompetitionFeatureEnabled(enabledFeatures, 'competition.dailyChallenge.enabled'), true);
assert.equal(isCompetitionFeatureEnabled(enabledFeatures, 'competition.studentVsStudent.enabled'), false);

assert.equal(await resolveCompetitionFeature(prismaWithSetting(), 'competition.enabled'), false);
assert.equal(await resolveCompetitionFeature(prismaWithSetting('{"competition.enabled":true,"competition.dailyChallenge.enabled":true}'), 'competition.dailyChallenge.enabled'), true);
assert.equal(await resolveCompetitionFeature(prismaWithSetting('{bad json'), 'competition.enabled'), false);
assert.equal(await resolveCompetitionFeature(prismaWithSetting(undefined, true), 'competition.enabled'), false);

console.log('Competition feature gate tests passed');