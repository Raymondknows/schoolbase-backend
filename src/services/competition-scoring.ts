export type CompetitionScoringPolicySnapshot = {
  basePoints: number;
  difficultyMultipliers?: Partial<Record<'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT', number>>;
  speedBonusEnabled?: boolean;
  speedBonusMaxPercent?: number;
  streakBonusEnabled?: boolean;
  streakBonusPerCorrect?: number;
};

export function parseCompetitionScoringPolicy(value: string): CompetitionScoringPolicySnapshot {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid scoring policy snapshot');
  const policy = parsed as Record<string, unknown>;
  if (!Number.isInteger(policy.basePoints) || Number(policy.basePoints) < 0) throw new Error('Invalid scoring policy base points');
  return policy as CompetitionScoringPolicySnapshot;
}

export function calculateCompetitionAnswerPoints(input: {
  isCorrect: boolean;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
  elapsedMs: number;
  timeLimitSeconds?: number | null;
  policy: CompetitionScoringPolicySnapshot;
}): number {
  if (!input.isCorrect) return 0;
  const base = input.policy.basePoints;
  const multiplier = input.policy.difficultyMultipliers?.[input.difficulty] ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 100) throw new Error('Invalid difficulty multiplier');
  let points = Math.round(base * multiplier);

  if (input.policy.speedBonusEnabled && input.timeLimitSeconds && input.timeLimitSeconds > 0) {
    const maxPercent = Math.min(100, Math.max(0, input.policy.speedBonusMaxPercent ?? 0));
    const remainingRatio = Math.min(1, Math.max(0, 1 - input.elapsedMs / (input.timeLimitSeconds * 1000)));
    points += Math.round(base * (maxPercent / 100) * remainingRatio);
  }

  return points;
}
