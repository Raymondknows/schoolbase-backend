import assert from 'node:assert/strict';
import { calculateCompetitionAnswerPoints, parseCompetitionScoringPolicy } from '../src/services/competition-scoring.js';

const policy = parseCompetitionScoringPolicy(JSON.stringify({ basePoints: 100, difficultyMultipliers: { EASY: 1, MEDIUM: 1.25, HARD: 1.5, EXPERT: 2 }, speedBonusEnabled: true, speedBonusMaxPercent: 20 }));
assert.equal(calculateCompetitionAnswerPoints({ isCorrect: true, difficulty: 'EASY', elapsedMs: 0, timeLimitSeconds: 60, policy }), 120);
assert.equal(calculateCompetitionAnswerPoints({ isCorrect: true, difficulty: 'HARD', elapsedMs: 30000, timeLimitSeconds: 60, policy }), 160);
assert.equal(calculateCompetitionAnswerPoints({ isCorrect: true, difficulty: 'EXPERT', elapsedMs: 90000, timeLimitSeconds: 60, policy }), 200);
assert.equal(calculateCompetitionAnswerPoints({ isCorrect: false, difficulty: 'EXPERT', elapsedMs: 0, timeLimitSeconds: 60, policy }), 0);
assert.throws(() => parseCompetitionScoringPolicy('{bad json'));
assert.throws(() => calculateCompetitionAnswerPoints({ isCorrect: true, difficulty: 'EASY', elapsedMs: 0, timeLimitSeconds: 60, policy: { basePoints: 100, difficultyMultipliers: { EASY: 1000 } } }));
console.log('Competition scoring tests passed');
