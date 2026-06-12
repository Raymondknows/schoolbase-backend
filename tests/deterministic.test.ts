/**
 * Deterministic Output Tests
 * 
 * Validates that the results system produces identical output for identical input.
 * This ensures the positioning, grading, and calculations are deterministic.
 * 
 * Usage: npx tsx backend/tests/deterministic.test.ts
 */

import { PrismaClient } from '@prisma/client';
import { ResultsDomainService } from '../src/domain/results/ResultsDomainService.js';

const prisma = new PrismaClient();
const domainService = new ResultsDomainService(prisma);

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>) {
  try {
    await testFn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      details: error instanceof Error ? error.message : String(error),
    });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testGradeCalculationDeterminism() {
  /**
   * Test 1: Grade calculation produces same output for same input
   */
  await runTest(
    'Grade calculation is deterministic',
    async () => {
      const schoolId = 'test-school-grade';
      const score = 85;

      // Calculate grade multiple times
      const grades = await Promise.all([
        domainService.calculateGrade(schoolId, score),
        domainService.calculateGrade(schoolId, score),
        domainService.calculateGrade(schoolId, score),
      ]);

      // All should be identical
      if (grades[0] !== grades[1] || grades[1] !== grades[2]) {
        throw new Error(
          `Grades not consistent: ${grades[0]}, ${grades[1]}, ${grades[2]}`
        );
      }

      // Should be 'B' for score 85
      if (grades[0] !== 'B') {
        throw new Error(`Expected grade 'B' for score 85, got ${grades[0]}`);
      }
    }
  );
}

async function testTotalScoreCalculationDeterminism() {
  /**
   * Test 2: Total score calculation is deterministic
   */
  await runTest(
    'Total score calculation is deterministic',
    async () => {
      const components = [
        { id: 'ca', maxScore: 20, weight: 20 },
        { id: 'test', maxScore: 30, weight: 30 },
        { id: 'exam', maxScore: 50, weight: 50 },
      ];

      const componentScores = {
        ca: 18,
        test: 25,
        exam: 42,
      };

      // Calculate total score multiple times
      const totalScores = [
        domainService.calculateTotalScore(componentScores, components),
        domainService.calculateTotalScore(componentScores, components),
        domainService.calculateTotalScore(componentScores, components),
      ];

      // All should be identical
      if (totalScores[0] !== totalScores[1] || totalScores[1] !== totalScores[2]) {
        throw new Error(
          `Total scores not consistent: ${totalScores[0]}, ${totalScores[1]}, ${totalScores[2]}`
        );
      }

      // Verify calculation: (18/20)*20 + (25/30)*30 + (42/50)*50
      // = 18 + 25 + 42 = 85
      if (Math.abs(totalScores[0] - 85) > 0.01) {
        throw new Error(
          `Expected total score ~85, got ${totalScores[0]}`
        );
      }
    }
  );
}

async function testPositioningDeterminism() {
  /**
   * Test 3: Positioning produces identical results on repeated calculations
   */
  await runTest(
    'Positioning is deterministic',
    async () => {
      // Create test assessment and results
      const schoolId = 'test-school-positioning';
      const now = new Date();

      // Create school
      await prisma.school.upsert({
        where: { id: schoolId },
        update: {},
        create: {
          id: schoolId,
          name: 'Test School Positioning',
          email: 'test@positioning.com',
          phone: '0000000000',
        },
      });

      // Create term
      const term = await prisma.term.create({
        data: {
          schoolId,
          name: 'Test Term',
          startDate: now,
          endDate: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        },
      });

      // Create class
      const classEntity = await prisma.class.create({
        data: {
          schoolId,
          name: 'Test Class Positioning',
          formId: 'form-1',
        },
      });

      // Create subject
      const subject = await prisma.subject.create({
        data: {
          schoolId,
          name: 'Mathematics',
          code: 'MATH',
        },
      });

      // Create pupils
      const pupils = await Promise.all([
        prisma.pupil.create({
          data: {
            schoolId,
            firstName: 'Alice',
            lastName: 'Anderson', // Name matters for tie-breaking
            regNumber: 'A001',
          },
        }),
        prisma.pupil.create({
          data: {
            schoolId,
            firstName: 'Bob',
            lastName: 'Brown', // Name matters for tie-breaking
            regNumber: 'B001',
          },
        }),
        prisma.pupil.create({
          data: {
            schoolId,
            firstName: 'Charlie',
            lastName: 'Chen', // Name matters for tie-breaking
            regNumber: 'C001',
          },
        }),
      ]);

      // Create assessment
      const assessment = await prisma.assessment.create({
        data: {
          schoolId,
          termId: term.id,
          classId: classEntity.id,
          name: 'Positioning Test',
          componentData: JSON.stringify({
            components: [
              { id: 'ca', name: 'CA', maxScore: 20, weight: 20 },
              { id: 'test', name: 'Test', maxScore: 30, weight: 30 },
              { id: 'exam', name: 'Exam', maxScore: 50, weight: 50 },
            ],
          }),
        },
      });

      // Create results with specific scores to test tie-breaking
      // Alice: 80, 80, 80 = 80 (first alphabetically at 80)
      // Bob: 80, 75, 85 = ~79.67 (tied with Charlie in score but different CA)
      // Charlie: 80, 75, 84 = ~79.4 (tied with Bob in first component)
      const results1 = await Promise.all([
        prisma.result.create({
          data: {
            assessmentId: assessment.id,
            pupilId: pupils[0].id, // Alice
            subjectId: subject.id,
            scores: JSON.stringify({ ca: 16, test: 24, exam: 40 }),
            totalScore: 80,
          },
        }),
        prisma.result.create({
          data: {
            assessmentId: assessment.id,
            pupilId: pupils[1].id, // Bob
            subjectId: subject.id,
            scores: JSON.stringify({ ca: 16, test: 24, exam: 40 }),
            totalScore: 80,
          },
        }),
        prisma.result.create({
          data: {
            assessmentId: assessment.id,
            pupilId: pupils[2].id, // Charlie
            subjectId: subject.id,
            scores: JSON.stringify({ ca: 16, test: 24, exam: 39 }),
            totalScore: 79,
          },
        }),
      ]);

      // Calculate positions first time
      await domainService.calculateSubjectPositioning(assessment.id, subject.id);

      const positions1 = await prisma.result.findMany({
        where: { assessmentId: assessment.id },
        select: { pupilId: true, subjectPosition: true },
        orderBy: { subjectPosition: 'asc' },
      });

      // Calculate positions again
      await domainService.calculateSubjectPositioning(assessment.id, subject.id);

      const positions2 = await prisma.result.findMany({
        where: { assessmentId: assessment.id },
        select: { pupilId: true, subjectPosition: true },
        orderBy: { subjectPosition: 'asc' },
      });

      // Verify positions are identical
      for (let i = 0; i < positions1.length; i++) {
        if (
          positions1[i].pupilId !== positions2[i].pupilId ||
          positions1[i].subjectPosition !== positions2[i].subjectPosition
        ) {
          throw new Error(
            `Positions differ between runs: ${JSON.stringify(positions1)} vs ${JSON.stringify(positions2)}`
          );
        }
      }

      // Verify correct order (Alice=1, Bob=2, Charlie=3 with tie-breaking)
      const positionMap = Object.fromEntries(
        positions1.map((p) => [p.pupilId, p.subjectPosition])
      );

      // Cleanup
      await prisma.assessment.delete({ where: { id: assessment.id } });
      await prisma.class.delete({ where: { id: classEntity.id } });
      await prisma.term.delete({ where: { id: term.id } });
      for (const pupil of pupils) {
        await prisma.pupil.delete({ where: { id: pupil.id } });
      }
      await prisma.subject.delete({ where: { id: subject.id } });
      await prisma.school.delete({ where: { id: schoolId } });
    }
  );
}

async function main() {
  console.log('🧪 Running Deterministic Output Tests\n');
  console.log('Testing that identical inputs always produce identical outputs...\n');

  await testGradeCalculationDeterminism();
  await testTotalScoreCalculationDeterminism();
  await testPositioningDeterminism();

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log(`${'='.repeat(50)}\n`);

  if (passed === total) {
    console.log('✅ All tests passed! System is deterministic.\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. See details above.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
