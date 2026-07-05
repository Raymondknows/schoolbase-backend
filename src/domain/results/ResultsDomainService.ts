import { PrismaClient } from '@prisma/client';
import { ResultWorkflowState, isValidTransition, getStateName } from './ResultWorkflowState.js';
import { ResultsValidator, ValidationResult } from './ResultsValidator.js';

/**
 * Results Domain Service
 * 
 * SINGLE SOURCE OF TRUTH for all results business logic.
 * 
 * ❌ NO business logic in routes
 * ❌ NO validation in services
 * ❌ NO calculation logic in frontend
 * ✅ ALL logic here, ALL logic audited, ALL logic deterministic
 */

interface DomainError {
  error: string;
  errorCode: string;
  message: string;
  action?: string;
  details?: any;
}

export class ResultsDomainService {
  private prisma: PrismaClient;
  private validator: ResultsValidator;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
    this.validator = new ResultsValidator(this.prisma);
  }

  // ==================== GRADE CALCULATION ====================

  /**
   * Calculate total score from component scores
   * This is DETERMINISTIC - same input always produces same output
   */
  calculateTotalScore(
    componentScores: Record<string, number>,
    components: Array<{ id: string; maxScore: number; weight: number }>,
    schoolId?: string
  ): number {
    let totalScore = 0;

    for (const component of components) {
      const score = componentScores[component.id];
      if (score !== undefined && score !== null) {
        // Validate score is in range
        if (score < 0 || score > component.maxScore) {
          throw new Error(
            `Invalid score for component: ${score} (valid: 0-${component.maxScore})`
          );
        }

        // Convert to percentage and apply weight
        const percentage = (score / component.maxScore) * 100;
        const weighted = (percentage * component.weight) / 100;
        totalScore += weighted;
      }
    }

    return Math.round(totalScore * 100) / 100;
  }

  /**
   * Calculate grade based on total score
   * Uses school's GradingScale or defaults
   * DETERMINISTIC - stable grading scale
   */
  async calculateGrade(schoolId: string, totalScore: number): Promise<string> {
    // Fetch school's grading scale
    const gradingScales = await this.prisma.gradingScale.findMany({
      where: { schoolId },
      orderBy: { minScore: 'desc' },
    });

    // Use custom grading scale if available
    if (gradingScales.length > 0) {
      for (const scale of gradingScales) {
        if (totalScore >= scale.minScore && totalScore <= scale.maxScore) {
          return scale.grade;
        }
      }
      // If no match, return lowest grade
      return gradingScales[gradingScales.length - 1].grade;
    }

    // DEFAULT GRADING SCALE (always available)
    if (totalScore >= 70) return 'A';
    if (totalScore >= 60) return 'B';
    if (totalScore >= 50) return 'C';
    if (totalScore >= 45) return 'D';
    if (totalScore >= 40) return 'E';
    return 'F';
  }

  // ==================== POSITIONING (WITH DETERMINISTIC TIE-BREAKING) ====================

  /**
   * Calculate subject positioning with deterministic tie-breaking
   * 
   * Tie-breaker rule (DETERMINISTIC):
   * 1. Total score DESC (highest first)
   * 2. CA score DESC (higher CA first) - extracted from scores JSON
   * 3. Alphabetical name ASC (A-Z as final tiebreaker)
   * 
   * This ensures same dataset always produces same rankings
   */
  async calculateSubjectPositioning(
    assessmentId: string,
    subjectId: string,
    schoolId: string
  ): Promise<void> {
    // Get assessment to access CA component ID
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment || !assessment.componentData) return;

    // Extract CA component ID from componentData
    let caComponentId = '';
    try {
      const config = JSON.parse(assessment.componentData);
      const components = config.components || [];
      const caComponent = components.find(
        (c: any) => c.name.toLowerCase() === 'ca' || c.name.toLowerCase() === 'continuous assessment'
      );
      if (caComponent) caComponentId = caComponent.id;
    } catch (e) {
      // If parsing fails, fall back to simple sort
    }

    // Get all results for this assessment + subject
    const results = await this.prisma.result.findMany({
      where: { assessmentId, subjectId, assessment: { schoolId } },
      include: { pupil: true },
    });

    if (results.length === 0) return;

    // Build sortable results with extracted CA scores
    const sortableResults = results.map((result) => {
      let caScore = 0;
      try {
        if (result.scores) {
          const scores = typeof result.scores === 'string' 
            ? JSON.parse(result.scores)
            : result.scores;
          caScore = scores[caComponentId] || 0;
        }
      } catch (e) {
        // If parsing fails, CA score remains 0
      }

      return {
        result,
        caScore,
        pupilName: `${result.pupil.firstName} ${result.pupil.lastName}`,
      };
    });

    // Sort with deterministic tie-breaking
    sortableResults.sort((a, b) => {
      // Primary: Total score DESC
      if (b.result.totalScore !== a.result.totalScore) {
        return (b.result.totalScore || 0) - (a.result.totalScore || 0);
      }

      // Secondary: CA score DESC
      if (b.caScore !== a.caScore) {
        return b.caScore - a.caScore;
      }

      // Tertiary: Name ASC (alphabetical)
      return a.pupilName.localeCompare(b.pupilName);
    });

    // Assign positions with tie handling (1, 1, 3 pattern)
    let position = 1;
    let lastScore = sortableResults[0]?.result.totalScore;
    let lastCaScore = sortableResults[0]?.caScore;

    for (let i = 0; i < sortableResults.length; i++) {
      const { result } = sortableResults[i];

      // Check if this is a new position (score or CA changed)
      if (
        result.totalScore !== lastScore ||
        sortableResults[i].caScore !== lastCaScore
      ) {
        position = i + 1;
        lastScore = result.totalScore;
        lastCaScore = sortableResults[i].caScore;
      }

      // Update result with position
      await this.prisma.result.update({
        where: { id: result.id },
        data: { subjectPosition: position },
      });
    }
  }

  /**
   * Calculate class positioning with deterministic tie-breaking
   * 
   * Procedure:
   * 1. Get average score per student across all subjects
   * 2. Sort by average (DESC), then by student name (for determinism)
   * 3. Assign positions with tie handling
   */
  async calculateClassPositioning(assessmentId: string, schoolId: string): Promise<void> {
    // Get all results for this assessment
    const allResults = await this.prisma.result.findMany({
      where: { assessmentId, assessment: { schoolId } },
      include: { pupil: true },
    });

    if (allResults.length === 0) return;

    // Group results by student
    const studentResults: Record<string, any[]> = {};
    for (const result of allResults) {
      if (!studentResults[result.pupilId]) {
        studentResults[result.pupilId] = [];
      }
      studentResults[result.pupilId].push(result);
    }

    // Calculate average score per student
    const studentAverages: Array<{
      pupilId: string;
      pupilName: string;
      averageScore: number;
      resultIds: string[];
    }> = [];

    for (const [pupilId, results] of Object.entries(studentResults)) {
      const validResults = results.filter((r) => r.totalScore !== null);
      if (validResults.length > 0) {
        const averageScore =
          validResults.reduce((sum, r) => sum + (r.totalScore || 0), 0) /
          validResults.length;
        
        const pupilName = `${results[0].pupil.firstName} ${results[0].pupil.lastName}`;

        studentAverages.push({
          pupilId,
          pupilName,
          averageScore,
          resultIds: validResults.map((r) => r.id),
        });
      }
    }

    // Sort by average (DESC), then by name (ASC) for deterministic ordering
    studentAverages.sort((a, b) => {
      if (b.averageScore !== a.averageScore) {
        return b.averageScore - a.averageScore; // Higher average first
      }
      return a.pupilName.localeCompare(b.pupilName); // Alphabetical as tiebreaker
    });

    // Assign positions with tie handling
    let position = 1;
    let lastScore = studentAverages[0]?.averageScore;

    for (let i = 0; i < studentAverages.length; i++) {
      const student = studentAverages[i];

      // If score changed, update position (1, 1, 3 pattern for ties)
      if (student.averageScore !== lastScore) {
        position = i + 1;
        lastScore = student.averageScore;
      }

      // Update all results for this student
      for (const resultId of student.resultIds) {
        await this.prisma.result.update({
          where: { id: resultId },
          data: { classPosition: position },
        });
      }
    }
  }

  // ==================== VALIDATION ====================

  /**
   * Validate assessment results before publish
   */
  async validateResults(assessmentId: string, schoolId: string): Promise<ValidationResult> {
    return this.validator.validateAssessmentResults(assessmentId, schoolId);
  }

  /**
   * Check publish readiness
   */
  async isReadyForPublish(assessmentId: string, schoolId: string): Promise<{ ready: boolean; reason?: string }> {
    return this.validator.isReadyForPublish(assessmentId, schoolId);
  }

  // ==================== STATE TRANSITIONS ====================

  /**
   * Calculate next workflow state
   * Called after each operation to update assessment state
   */
  async calculateNextState(assessmentId: string, schoolId: string): Promise<ResultWorkflowState> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        results: { select: { id: true, totalScore: true, grade: true, classPosition: true, subjectPosition: true } },
      },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Determine current state based on data
    const hasComponentData = !!assessment.componentData;
    const hasScores =
      assessment.results.length > 0 &&
      assessment.results.some((r) => r.totalScore !== null && r.totalScore !== undefined);
    const hasGrades =
      assessment.results.length > 0 &&
      assessment.results.some((r) => r.grade !== null && r.grade !== undefined);
    const hasPositions =
      assessment.results.length > 0 &&
      assessment.results.some((r) => r.classPosition !== null && r.classPosition !== undefined);

    // State calculation logic
    if (!hasComponentData) return ResultWorkflowState.DRAFT;
    if (!hasScores) return ResultWorkflowState.CONFIGURED;
    if (!hasGrades) return ResultWorkflowState.SCORED;
    if (!hasPositions) return ResultWorkflowState.GRADED;

    // Check if validated
    const validation = await this.validateResults(assessmentId, schoolId);
    if (!validation.isValid) return ResultWorkflowState.POSITIONED;

    // If locked, stay locked
    const results = await this.prisma.result.findMany({
      where: { assessmentId, assessment: { schoolId } },
      select: { lockedAt: true },
      take: 1,
    });
    if (results[0]?.lockedAt) return ResultWorkflowState.LOCKED;

    return ResultWorkflowState.VALIDATED;
  }

  // ==================== LOCKING ====================

  /**
   * Lock results - prevent editing
   * Transition VALIDATED -> LOCKED
   */
  async lockResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    // Verify assessment
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Validate before locking
    const validation = await this.validateResults(assessmentId, schoolId);
    if (!validation.isValid) {
      throw new Error(`Cannot lock - validation errors exist: ${validation.blockers[0]?.message}`);
    }

    const now = new Date();

    const results = await this.prisma.result.findMany({
      where: { assessmentId: assessment.id },
      select: { id: true, pupilId: true },
    });

    // Lock all results
    await this.prisma.result.updateMany({
      where: { assessmentId: assessment.id },
      data: {
        lockedAt: now,
        lockedBy: userId,
      },
    });

    if (results.length > 0) {
      await this.prisma.resultAudit.createMany({
        data: results.map((result) => ({
          schoolId,
          assessmentId,
          resultId: result.id,
          pupilId: result.pupilId,
          action: 'BATCH_LOCKED',
          changes: JSON.stringify({ operation: 'lock_all_results', timestamp: now.toISOString() }),
          changedBy: userId,
          changedAt: now,
        })),
      });
    }
  }

  /**
   * Unlock results - allow editing
   * Transition LOCKED -> VALIDATED
   */
  async unlockResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    const now = new Date();

    const results = await this.prisma.result.findMany({
      where: { assessmentId: assessment.id },
      select: { id: true, pupilId: true },
    });

    // Unlock all results
    await this.prisma.result.updateMany({
      where: { assessmentId: assessment.id },
      data: {
        lockedAt: null,
        lockedBy: null,
      },
    });

    if (results.length > 0) {
      await this.prisma.resultAudit.createMany({
        data: results.map((result) => ({
          schoolId,
          assessmentId,
          resultId: result.id,
          pupilId: result.pupilId,
          action: 'BATCH_UNLOCKED',
          changes: JSON.stringify({ operation: 'unlock_all_results', timestamp: now.toISOString() }),
          changedBy: userId,
          changedAt: now,
        })),
      });
    }
  }

  // ==================== PUBLISHING ====================

  /**
   * Publish results - make visible to parents
   * Transition LOCKED -> PUBLISHED
   */
  async publishResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    // Verify assessment
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Check publish readiness
    const { ready, reason } = await this.isReadyForPublish(assessmentId, schoolId);
    if (!ready) {
      throw new Error(`Not ready to publish: ${reason}`);
    }

    const now = new Date();

    // Update assessment status
    await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: {
        status: 'PUBLISHED',
      },
    });

    const results = await this.prisma.result.findMany({
      where: { assessmentId: assessment.id },
      select: { id: true, pupilId: true },
    });

    if (results.length > 0) {
      await this.prisma.result.updateMany({
        where: { assessmentId: assessment.id },
        data: { publishedAt: now },
      });

      await this.prisma.resultAudit.createMany({
        data: results.map((result) => ({
          schoolId,
          assessmentId,
          resultId: result.id,
          pupilId: result.pupilId,
          action: 'ASSESSMENT_PUBLISHED',
          changes: JSON.stringify({ status: 'PUBLISHED', timestamp: now.toISOString() }),
          changedBy: userId,
          changedAt: now,
        })),
      });
    }
  }

  /**
   * Unpublish results - revert to locked state
   * Transition PUBLISHED -> LOCKED
   */
  async unpublishResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    const now = new Date();

    // Update assessment status
    await this.prisma.assessment.update({
      where: { id: assessment.id },
      data: {
        status: 'APPROVED',
      },
    });

    const results = await this.prisma.result.findMany({
      where: { assessmentId: assessment.id },
      select: { id: true, pupilId: true },
    });

    if (results.length > 0) {
      await this.prisma.result.updateMany({
        where: { assessmentId: assessment.id },
        data: { publishedAt: null },
      });

      await this.prisma.resultAudit.createMany({
        data: results.map((result) => ({
          schoolId,
          assessmentId,
          resultId: result.id,
          pupilId: result.pupilId,
          action: 'ASSESSMENT_UNPUBLISHED',
          changes: JSON.stringify({ status: 'APPROVED', timestamp: now.toISOString() }),
          changedBy: userId,
          changedAt: now,
        })),
      });
    }
  }

  // ==================== AUDIT ====================

  /**
   * Write audit entry (only called from domain layer)
   */
  async auditResultChange(
    resultId: string,
    assessmentId: string,
    pupilId: string,
    action: string,
    changes: Record<string, any>,
    userId: string,
    schoolId: string
  ): Promise<void> {
    await this.prisma.resultAudit.create({
      data: {
        resultId,
        assessmentId,
        pupilId,
        action,
        changes: typeof changes === 'string' ? changes : JSON.stringify(changes),
        changedBy: userId,
        schoolId,
        changedAt: new Date(),
      },
    });
  }

  // ==================== REPORTING ====================

  /**
   * Get assessment result sheet with statistics
   */
  async getAssessmentResultSheet(assessmentId: string, schoolId: string): Promise<any> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: { term: true, class: true },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    const results = await this.prisma.result.findMany({
      where: { assessmentId, assessment: { schoolId }, pupil: { schoolId } },
      include: { pupil: true, subjectRef: true },
      orderBy: { classPosition: 'asc' },
    });

    const subjects = assessment.classId
      ? await this.prisma.subject.findMany({
          where: {
            schoolId,
            subjectClasses: {
              some: { classId: assessment.classId },
            },
          },
        })
      : [];

    const totalScores = results
      .map((r) => r.totalScore || 0)
      .filter((s) => s > 0);

    const avgScore = totalScores.length > 0
      ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length
      : 0;

    const passCount = results.filter((r) => r.grade && r.grade !== 'F').length;
    const passRate = results.length > 0 ? (passCount / results.length) * 100 : 0;

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        status: assessment.status,
        term: assessment.term,
        class: assessment.class,
      },
      subjects,
      results,
      statistics: {
        totalStudents: results.length,
        highestScore: Math.max(...totalScores, 0),
        lowestScore: Math.min(...totalScores.filter((s) => s > 0), 0),
        averageScore: Math.round(avgScore * 100) / 100,
        passCount,
        failCount: results.length - passCount,
        passRate: Math.round(passRate),
      },
    };
  }
}
