import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDistinctStudentCount } from '../src/services/report-card-statistics.ts';

describe('getDistinctStudentCount', () => {
  it('counts unique pupils even when multiple result rows exist for the same student', () => {
    const results = [
      { pupilId: 'p1' },
      { pupilId: 'p1' },
      { pupilId: 'p2' },
      { pupilId: 'p3' },
    ];

    assert.equal(getDistinctStudentCount(results), 3);
  });

  it('ignores missing pupil ids', () => {
    const results = [{ pupilId: null }, { pupilId: undefined }, { pupilId: 'p4' }];

    assert.equal(getDistinctStudentCount(results), 1);
  });
});
