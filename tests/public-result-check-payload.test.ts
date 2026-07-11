import assert from 'node:assert/strict';
import { buildPublicResultPayloadItem } from '../src/routes/public.js';

const item = buildPublicResultPayloadItem({
  assessmentId: 'assessment-1',
  assessmentName: 'First Test',
  termName: 'First Term',
  termId: 'term-1',
  totalScore: 78,
  caScore: 20,
  testScore: 18,
  examScore: 40,
  grade: 'B',
});

assert.equal(item.assessmentId, 'assessment-1');
assert.equal(item.subject, 'First Test');
assert.equal(item.term, 'First Term');
assert.equal(item.totalScore, 78);
assert.equal(item.grade, 'B');

console.log('public result payload helper ok');
