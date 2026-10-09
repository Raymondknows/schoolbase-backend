import assert from 'node:assert/strict';
import { calculateAge, matchesCompetitionAudience, parseCompetitionAudience } from '../src/services/competition-audience.js';

const referenceDate = new Date('2026-10-09T12:00:00.000Z');

assert.deepEqual(parseCompetitionAudience('Ages 10-11 · Primary 5'), {
  minimumAge: 10,
  maximumAge: 11,
  classLabel: 'Primary 5',
});
assert.equal(parseCompetitionAudience('Primary 5'), null);
assert.equal(calculateAge(new Date('2015-10-10T00:00:00.000Z'), referenceDate), 10);
assert.equal(calculateAge(new Date('2015-10-09T00:00:00.000Z'), referenceDate), 11);

const pupil = { audienceLabel: 'Ages 10-11 · Primary 5', className: 'Primary 5', dateOfBirth: new Date('2015-10-10T00:00:00.000Z'), onDate: referenceDate };
assert.equal(matchesCompetitionAudience(pupil), true);
assert.equal(matchesCompetitionAudience({ ...pupil, className: 'JSS3' }), false);
assert.equal(matchesCompetitionAudience({ ...pupil, dateOfBirth: null }), false);
assert.equal(matchesCompetitionAudience({ ...pupil, audienceLabel: 'JSS3' }), false);

console.log('Competition audience tests passed');