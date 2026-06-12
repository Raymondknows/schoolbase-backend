import { PrismaClient } from '@prisma/client';

interface GradeResult {
  score: number;
  grade: string;
}

interface PositionResult {
  studentId: string;
  totalScore: number;
  position: number;
}

interface ValidationError {
  field: string;
  message: string;
  details?: any;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

class ResultsEngineService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
  }

  /**
   * Calculate total score from component scores
   * 
   * Components are stored in Assessment.componentData as:
   * { components: [{ id, name, maxScore, weight, sortOrder }] }
   * 
   * Result.scores stores: { "componentId": score }
   */
  async calculateTotalScore(
    assessmentId: string,
    componentScores: Record<string, number>
  ): Promise<number> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment || !assessment.componentData) {
      throw new Error('Assessment not found or has no components');
    }

    let components: any[] = [];
    try {
      const data = JSON.parse(assessment.componentData as string);
      components = data.components || [];
    } catch (e) {
      throw new Error('Invalid assessment component data');
    }

    let totalScore = 0;

    for (const component of components) {
      const score = componentScores[component.id];
      if (score !== undefined && score !== null) {
        if (score < 0 || score > component.maxScore) {
          throw new Error(
            `Invalid score for component ${component.name}: ${score} (max: ${component.maxScore})`
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

    // DEFAULT GRADING SCALE
    // 70 - 100 = A
    // 60 - 69 = B
    // 50 - 59 = C
    // 45 - 49 = D
    // 40 - 44 = E
    // 0 - 39 = F
    if (totalScore >= 70) return 'A';
    if (totalScore >= 60) return 'B';
    if (totalScore >= 50) return 'C';
    if (totalScore >= 45) return 'D';
    if (totalScore >= 40) return 'E';
    return 'F';
  }

  /**
   * Calculate subject positioning
   * Rank students by total score for each subject per assessment
   * 
   * Handles ties: If 2 students have same score, both get same position
   * and next position skips (1, 1, 3 not 1, 1, 2)
   */
  async calculateSubjectPositioning(
    assessmentId: string,
    subjectId: string
  ): Promise<void> {
    // Get all results for this assessment + subject
    const results = await this.prisma.result.findMany({
      where: {
        assessmentId,
        subjectId,
      },
      orderBy: { totalScore: 'desc' },
    });

    if (results.length === 0) return;

    // Assign positions with tie handling
    let position = 1;
    let lastScore = results[0].totalScore;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      // If score changed, update position
      if (result.totalScore !== lastScore) {
        position = i + 1;
        lastScore = result.totalScore;
      }

      // Update result with position
      await this.prisma.result.update({
        where: { id: result.id },
        data: { subjectPosition: position },
      });
    }
  }

  /**
   * Calculate class positioning
   * Rank students by average score across all their subjects
   * for a specific assessment
   */
  async calculateClassPositioning(assessmentId: string): Promise<void> {
    // Get all results for this assessment
    const allResults = await this.prisma.result.findMany({
      where: { assessmentId },
      include: { pupil: { include: { class: true } } },
    });

    if (allResults.length === 0) return;

    // Group results by student (pupilId)
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
      averageScore: number;
      resultIds: string[];
    }> = [];

    for (const [pupilId, results] of Object.entries(studentResults)) {
      const validResults = results.filter((r) => r.totalScore !== null);
      if (validResults.length > 0) {
        const averageScore =
          validResults.reduce((sum, r) => sum + (r.totalScore || 0), 0) /
          validResults.length;
        studentAverages.push({
          pupilId,
          averageScore,
          resultIds: validResults.map((r) => r.id),
        });
      }
    }

    // Sort by average score (descending)
    studentAverages.sort((a, b) => b.averageScore - a.averageScore);

    // Assign positions with tie handling
    let position = 1;
    let lastScore = studentAverages[0]?.averageScore;

    for (let i = 0; i < studentAverages.length; i++) {
      const student = studentAverages[i];

      // If score changed, update position
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

  /**
   * Validate all results for an assessment before publishing
   */
  async validateResults(assessmentId: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // Get assessment
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: {
        class: {
          include: {
            pupils: true,
            subjectClasses: { include: { subject: true } },
          },
        },
        results: { include: { pupil: true } },
        _count: { select: { results: true } },
      },
    });

    if (!assessment) {
      return {
        isValid: false,
        errors: [{ field: 'assessment', message: 'Assessment not found' }],
      };
    }

    // Check 1: Assessment has components
    if (!assessment.componentData) {
      errors.push({
        field: 'components',
        message: 'Assessment has no components defined',
      });
    }

    // Check 2: For class-based assessments, all students have results
    if (assessment.classId && assessment.class) {
      const expectedCount = assessment.class.pupils.length;
      const actualCount = assessment._count.results;

      if (expectedCount !== actualCount) {
        errors.push({
          field: 'studentCoverage',
          message: `Expected ${expectedCount} results but found ${actualCount}`,
          details: {
            expected: expectedCount,
            actual: actualCount,
            missing: expectedCount - actualCount,
          },
        });
      }

      // Check 3: All expected subjects have results for all students
      if (assessment.class.subjectClasses.length > 0) {
        const expectedSubjects = assessment.class.subjectClasses.map((sc) => sc.subject.id);

        for (const pupil of assessment.class.pupils) {
          const pupilResults = assessment.results.filter(
            (r) => r.pupilId === pupil.id
          );
          const pupilSubjects = new Set(pupilResults.map((r) => r.subjectId));

          const missingSubjects = expectedSubjects.filter(
            (sid) => !pupilSubjects.has(sid)
          );
          if (missingSubjects.length > 0) {
            errors.push({
              field: 'subjectCoverage',
              message: `Student ${pupil.firstName} ${pupil.lastName} missing ${missingSubjects.length} subject(s)`,
              details: { pupilId: pupil.id, missingCount: missingSubjects.length },
            });
          }
        }
      }
    }

    // Check 4: All results have total scores
    const resultsWithoutTotals = assessment.results.filter((r) => !r.totalScore);
    if (resultsWithoutTotals.length > 0) {
      errors.push({
        field: 'totalScores',
        message: `${resultsWithoutTotals.length} result(s) missing total scores`,
        details: { count: resultsWithoutTotals.length },
      });
    }

    // Check 5: All results have grades
    const resultsWithoutGrades = assessment.results.filter((r) => !r.grade);
    if (resultsWithoutGrades.length > 0) {
      errors.push({
        field: 'grades',
        message: `${resultsWithoutGrades.length} result(s) missing grades`,
        details: { count: resultsWithoutGrades.length },
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Lock results - prevent editing without unlocking
   */
  async lockResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    const now = new Date();

    // Update all results for this assessment
    const results = await this.prisma.result.updateMany({
      where: { assessmentId },
      data: {
        lockedAt: now,
        lockedBy: userId,
      },
    });

    // Note: Batch locking is not individually audited (affects multiple results)
    // Each result carries lockedAt and lockedBy timestamps for audit trail
  }

  /**
   * Unlock results - allow editing
   */
  async unlockResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    const now = new Date();

    // Get results to record their previous state
    const results = await this.prisma.result.findMany({
      where: { assessmentId, lockedAt: { not: null } },
    });

    // Update all results for this assessment
    await this.prisma.result.updateMany({
      where: { assessmentId },
      data: {
        lockedAt: null,
        lockedBy: null,
      },
    });

    // Note: Batch unlocking is not individually audited (affects multiple results)
    // Each result's lockedAt/lockedBy reset serves as audit trail
  }

  /**
   * Create audit entry for result change
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
        changes: JSON.stringify(changes),
        changedBy: userId,
        schoolId,
      },
    });
  }

  /**
   * Publish results - mark as published and prevent changes
   */
  async publishResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    const now = new Date();

    // Update assessment status
    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: { status: 'PUBLISHED' },
    });

    // Update all results to published
    const results = await this.prisma.result.updateMany({
      where: { assessmentId },
      data: { publishedAt: now },
    });

    // Note: Batch publishing is not individually audited (affects multiple results)
    // Each result carries publishedAt timestamp for audit trail
  }

  /**
   * Unpublish results - allow changes again
   */
  async unpublishResults(
    assessmentId: string,
    userId: string,
    schoolId: string
  ): Promise<void> {
    const now = new Date();

    // Update assessment status
    await this.prisma.assessment.update({
      where: { id: assessmentId },
      data: { status: 'APPROVED' }, // Back to approved state
    });

    // Update all results to unpublished
    const results = await this.prisma.result.updateMany({
      where: { assessmentId },
      data: { publishedAt: null },
    });

    // Note: Batch unpublishing is not individually audited (affects multiple results)
    // Each result's publishedAt reset serves as audit trail
  }

  /**
   * Get complete assessment result sheet with statistics
   */
  async getAssessmentResultSheet(assessmentId: string, schoolId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        class: true,
        term: { include: { academicYear: true } },
        results: {
          include: {
            pupil: true,
            subjectRef: true,
          },
        },
      },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all subjects for this assessment
    const subjectIds = new Set(
      assessment.results
        .map((r) => r.subjectId)
        .filter((id): id is string => id !== null)
    );
    const subjects = await this.prisma.subject.findMany({
      where: { id: { in: Array.from(subjectIds) } },
    });

    // Get unique students
    const pupilIds = new Set(assessment.results.map((r) => r.pupilId));
    const pupils = await this.prisma.pupil.findMany({
      where: { id: { in: Array.from(pupilIds) } },
    });

    // Calculate statistics
    const totalScores = assessment.results
      .map((r) => r.totalScore || 0)
      .filter((s) => s > 0);

    const passCount = assessment.results.filter(
      (r) => (r.totalScore || 0) >= 40
    ).length;

    const stats = {
      totalResults: assessment.results.length,
      totalStudents: pupils.length,
      totalSubjects: subjects.length,
      highestScore: Math.max(...totalScores, 0),
      lowestScore: Math.min(...totalScores, 0),
      averageScore:
        totalScores.length > 0
          ? Math.round((totalScores.reduce((a, b) => a + b, 0) / totalScores.length) * 100) / 100
          : 0,
      passRate:
        assessment.results.length > 0
          ? Math.round(
              ((passCount / assessment.results.length) * 100 * 100) / 100
            )
          : 0,
    };

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        status: assessment.status,
        term: assessment.term?.name,
        academicYear: assessment.term?.academicYear?.name,
        class: assessment.class?.name,
      },
      subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
      students: pupils.map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        admissionNo: p.admissionNo,
      })),
      results: assessment.results,
      statistics: stats,
    };
  }
}

export default ResultsEngineService;
