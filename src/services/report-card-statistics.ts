export type ResultLike = {
  pupilId?: string | null;
};

export function getDistinctStudentCount(results: ResultLike[]) {
  const seen = new Set<string>();

  results.forEach((result) => {
    const pupilId = result.pupilId?.trim();
    if (pupilId) {
      seen.add(pupilId);
    }
  });

  return seen.size;
}
