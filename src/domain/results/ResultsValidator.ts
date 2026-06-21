import { PrismaClient } from '@prisma/client';
import { ResultWorkflowState } from './ResultWorkflowState.js';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  details?: any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  blockers: ValidationError[]; // Errors that prevent publishing
}

/**
 * Centralized Results Validation Engine
 * 
 * All validation logic must go through this service.
 * No validation logic should exist in routes.
 */
export class ResultsValidator {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
  }

  /**
   * Comprehensive validation for results
   * Used before publish or other critical operations
   */
  async validateAssessmentResults(assessmentId: string, schoolId: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const blockers: ValidationError[] = [];

    // Fetch assessment with full context
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        class: {
          include: {
            pupils: true,
            subjectClasses: { include: { subject: true } },
          },
        },
        results: {
          include: { pupil: true, subjectRef: true },
        },
        _count: { select: { results: true } },
      },
    });

    if (!assessment) {
      return {
        isValid: false,
        errors: [{
          field: 'assessment',
          message: 'Assessment not found',
          severity: 'error',
        }],
        warnings: [],
        blockers: [{
          field: 'assessment',
          message: 'Assessment not found',
          severity: 'error',
        }],
      };
    }

    // VALIDATION 1: Component configuration
    const componentError = this.validateComponentData(assessment.componentData);
    if (componentError) {
      errors.push(componentError);
      blockers.push(componentError);
    }

    // VALIDATION 2: Grading scale exists
    const gradingScales = await this.prisma.gradingScale.findMany({
      where: { schoolId: assessment.schoolId },
    });

    if (gradingScales.length === 0) {
      const warn: ValidationError = {
        field: 'gradingScale',
        message: 'No custom grading scale defined. Using defaults.',
        severity: 'warning',
      };
      warnings.push(warn);
    }

    // VALIDATION 3: Student coverage
    if (assessment.classId && assessment.class) {
      const expectedCount = assessment.class.pupils.length;
      const actualCount = assessment._count.results;

      if (expectedCount !== actualCount) {
        const error: ValidationError = {
          field: 'studentCoverage',
          message: `Student coverage incomplete: ${actualCount}/${expectedCount} students have results`,
          severity: 'error',
          details: {
            expected: expectedCount,
            actual: actualCount,
            missing: expectedCount - actualCount,
          },
        };
        errors.push(error);
        blockers.push(error);
      }

      // VALIDATION 4: Subject coverage per student
      const missingSubjects: Array<{ pupilName: string; subjectName: string }> = [];

      if (assessment.class.subjectClasses.length > 0) {
        const expectedSubjects = new Set(assessment.class.subjectClasses.map((sc) => sc.subject.id));

        for (const pupil of assessment.class.pupils) {
          const pupilResults = assessment.results.filter((r) => r.pupilId === pupil.id);
          const pupilSubjects = new Set(pupilResults.map((r) => r.subjectId));

          for (const subjectId of expectedSubjects) {
            if (!pupilSubjects.has(subjectId)) {
              const subject = assessment.class.subjectClasses.find(
                (sc) => sc.subject.id === subjectId
              )?.subject;
              missingSubjects.push({
                pupilName: `${pupil.firstName} ${pupil.lastName}`,
                subjectName: subject?.name || 'Unknown',
              });
            }
          }
        }

        if (missingSubjects.length > 0) {
          const error: ValidationError = {
            field: 'subjectCoverage',
            message: `${missingSubjects.length} student-subject pairs missing results`,
            severity: 'error',
            details: {
              count: missingSubjects.length,
              samples: missingSubjects.slice(0, 5),
            },
          };
          errors.push(error);
          blockers.push(error);
        }
      }
    }

    // VALIDATION 5: Total scores exist
    const resultsWithoutTotals = assessment.results.filter((r) => !r.totalScore);
    if (resultsWithoutTotals.length > 0) {
      const error: ValidationError = {
        field: 'totalScores',
        message: `${resultsWithoutTotals.length} result(s) missing total scores`,
        severity: 'error',
        details: { count: resultsWithoutTotals.length },
      };
      errors.push(error);
      blockers.push(error);
    }

    // VALIDATION 6: Grades assigned
    const resultsWithoutGrades = assessment.results.filter((r) => !r.grade);
    if (resultsWithoutGrades.length > 0) {
      const error: ValidationError = {
        field: 'grades',
        message: `${resultsWithoutGrades.length} result(s) missing grades`,
        severity: 'error',
        details: { count: resultsWithoutGrades.length },
      };
      errors.push(error);
      blockers.push(error);
    }

    // VALIDATION 7: Positions calculated
    const resultsWithoutPositions = assessment.results.filter(
      (r) => !r.classPosition || !r.subjectPosition
    );
    if (resultsWithoutPositions.length > 0) {
      const error: ValidationError = {
        field: 'positions',
        message: `${resultsWithoutPositions.length} result(s) missing positions`,
        severity: 'error',
        details: { count: resultsWithoutPositions.length },
      };
      errors.push(error);
      blockers.push(error);
    }

    // VALIDATION 8: Score ranges valid
    if (assessment.componentData) {
      try {
        const config = JSON.parse(assessment.componentData);
        const components = config.components || [];

        for (const result of assessment.results) {
          if (result.totalScore !== null && result.totalScore !== undefined) {
            if (result.totalScore < 0 || result.totalScore > 100) {
              const warn: ValidationError = {
                field: 'scoreRange',
                message: `Student ${result.pupil.firstName} has invalid total score: ${result.totalScore}`,
                severity: 'warning',
                details: {
                  studentId: result.pupilId,
                  score: result.totalScore,
                },
              };
              warnings.push(warn);
            }
          }
        }
      } catch (e) {
        // Component parsing error already caught in VALIDATION 1
      }
    }

    return {
      isValid: blockers.length === 0,
      errors,
      warnings,
      blockers,
    };
  }

  /**
   * Validate component data structure
   */
  private validateComponentData(componentData: string | null): ValidationError | null {
    if (!componentData) {
      return {
        field: 'componentData',
        message: 'Assessment has no component structure defined',
        severity: 'error',
        details: {
          action: 'CONFIGURE_COMPONENTS',
        },
      };
    }

    try {
      const data = JSON.parse(componentData);
      const components = data.components || [];

      if (!Array.isArray(components) || components.length === 0) {
        return {
          field: 'componentData',
          message: 'No components defined in assessment structure',
          severity: 'error',
        };
      }

      // Validate total weight = 100%
      const totalWeight = components.reduce((sum: number, c: any) => sum + (c.weight || 0), 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        return {
          field: 'componentData',
          message: `Component weights total ${totalWeight}%, must equal 100%`,
          severity: 'error',
          details: { totalWeight },
        };
      }

      // Validate each component
      for (const component of components) {
        if (!component.name || component.maxScore === undefined || component.weight === undefined) {
          return {
            field: 'componentData',
            message: `Component missing required fields: ${component.name || 'unnamed'}`,
            severity: 'error',
          };
        }

        if (component.maxScore <= 0) {
          return {
            field: 'componentData',
            message: `Component "${component.name}" has invalid maxScore: ${component.maxScore}`,
            severity: 'error',
          };
        }

        if (component.weight < 0 || component.weight > 100) {
          return {
            field: 'componentData',
            message: `Component "${component.name}" has invalid weight: ${component.weight}%`,
            severity: 'error',
          };
        }
      }

      return null;
    } catch (e) {
      return {
        field: 'componentData',
        message: 'Invalid component data format (not valid JSON)',
        severity: 'error',
      };
    }
  }

  /**
   * Validate single result entry
   */
  async validateResultEntry(
    resultId: string,
    scores: Record<string, number>,
    assessmentId: string,
    schoolId: string
  ): Promise<ValidationResult> {
    const result = await this.prisma.result.findFirst({
      where: { id: resultId, assessment: { schoolId } },
      include: { assessment: true, pupil: true },
    });

    if (!result) {
      return {
        isValid: false,
        errors: [{
          field: 'result',
          message: 'Result not found',
          severity: 'error',
        }],
        warnings: [],
        blockers: [{
          field: 'result',
          message: 'Result not found',
          severity: 'error',
        }],
      };
    }

    if (result.assessment.schoolId !== schoolId) {
      return {
        isValid: false,
        errors: [{ field: 'result', message: 'Result not found', severity: 'error' }],
        warnings: [],
        blockers: [{ field: 'result', message: 'Result not found', severity: 'error' }],
      };
    }

    const errors: ValidationError[] = [];
    const blockers: ValidationError[] = [];

    // Check assessment has components
    const componentError = this.validateComponentData(result.assessment.componentData);
    if (componentError) {
      return {
        isValid: false,
        errors: [componentError],
        warnings: [],
        blockers: [componentError],
      };
    }

    // Validate score ranges
    try {
      const config = JSON.parse(result.assessment.componentData!);
      const components = config.components || [];

      for (const component of components) {
        const score = scores[component.id];
        if (score !== undefined && score !== null) {
          if (score < 0 || score > component.maxScore) {
            const error: ValidationError = {
              field: 'score',
              message: `${component.name}: ${score} is outside valid range 0-${component.maxScore}`,
              severity: 'error',
            };
            errors.push(error);
            blockers.push(error);
          }
        }
      }
    } catch (e) {
      // Already validated above
    }

    return {
      isValid: blockers.length === 0,
      errors,
      warnings: [],
      blockers,
    };
  }

  /**
   * Check if ready for publish
   */
  async isReadyForPublish(assessmentId: string, schoolId: string): Promise<{ ready: boolean; reason?: string }> {
    const validation = await this.validateAssessmentResults(assessmentId, schoolId);

    if (!validation.isValid) {
      return {
        ready: false,
        reason: `Validation failed: ${validation.blockers[0]?.message || 'Unknown error'}`,
      };
    }

    return { ready: true };
  }
}
