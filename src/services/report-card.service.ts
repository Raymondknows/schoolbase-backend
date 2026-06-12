import { PrismaClient } from '@prisma/client';

interface SubjectResult {
  subjectId: string;
  subjectName: string;
  totalScore: number;
  grade: string;
  subjectPosition: number | null;
  teacherRemark: string | null;
  comment: string | null;
}

interface ReportCardData {
  student: {
    id: string;
    name: string;
    admissionNo: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    photoUrl: string | null;
  };
  school: {
    id: string;
    name: string;
    address: string | null;
    logoUrl: string | null;
    stampUrl: string | null;
    principalName: string | null;
    principalSignatureUrl: string | null;
    initials: string | null;
  };
  class: {
    name: string;
    phase: string;
  };
  term: {
    name: string;
    session: string; // Academic year name
  };
  subjects: SubjectResult[];
  averageScore: number;
  classPosition: number | null;
  totalSubjects: number;
  teacherRemark: string | null;
  principalRemark: string | null;
  statistics: {
    highestScore: number;
    lowestScore: number;
    passRate: number; // Percentage
  };
}

class ReportCardService {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || new PrismaClient();
  }

  /**
   * Generate complete report card data for a student on an assessment
   */
  async generateReportCard(
    assessmentId: string,
    pupilId: string,
    schoolId: string
  ): Promise<ReportCardData> {
    // Get assessment with all details
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        term: { include: { academicYear: true } },
        class: true,
      },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get pupil
    const pupil = await this.prisma.pupil.findUnique({
      where: { id: pupilId },
      include: { class: true },
    });

    if (!pupil) {
      throw new Error('Student not found');
    }

    // Get school
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    if (!school) {
      throw new Error('School not found');
    }

    // Get all results for this student in this assessment
    const results = await this.prisma.result.findMany({
      where: {
        assessmentId,
        pupilId,
      },
      include: {
        subjectRef: true,
      },
    });

    // Get class info (use from pupil or assessment)
    const classInfo = pupil.class || assessment.class;
    if (!classInfo) {
      throw new Error('Class information not found');
    }

    // Build subject results
    const subjects: SubjectResult[] = results
      .filter((r) => r.subjectRef) // Only include results with valid subjects
      .map((r) => ({
        subjectId: r.subjectId || '',
        subjectName: r.subjectRef?.name || 'Unknown',
        totalScore: r.totalScore || 0,
        grade: r.grade || 'N/A',
        subjectPosition: r.subjectPosition,
        teacherRemark: r.teacherRemark,
        comment: r.comment,
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    // Calculate statistics
    const validScores = subjects.filter((s) => s.totalScore > 0).map((s) => s.totalScore);
    const averageScore =
      validScores.length > 0
        ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 100) / 100
        : 0;

    const passCount = subjects.filter((s) => s.totalScore >= 40).length;
    const passRate =
      subjects.length > 0
        ? Math.round((passCount / subjects.length) * 100 * 100) / 100
        : 0;

    // Get student's class position (should be same across all subjects)
    const classPosition = results[0]?.classPosition || null;

    // Get principal remark (from school settings or first result)
    const principalRemark = school.principalComment || results[0]?.principalRemark || null;

    // Get teacher remark (from first result with one)
    const teacherRemark =
      results.find((r) => r.teacherRemark)?.teacherRemark ||
      results[0]?.comment ||
      null;

    return {
      student: {
        id: pupil.id,
        name: `${pupil.firstName} ${pupil.lastName}${pupil.middleName ? ' ' + pupil.middleName : ''}`.trim(),
        admissionNo: pupil.admissionNo,
        gender: pupil.gender,
        dateOfBirth: pupil.dateOfBirth?.toISOString().split('T')[0] || null,
        photoUrl: pupil.photoUrl,
      },
      school: {
        id: school.id,
        name: school.name,
        address: school.address,
        logoUrl: school.logoUrl,
        stampUrl: school.stampUrl,
        principalName: school.principalName,
        principalSignatureUrl: school.principalSignatureUrl,
        initials: school.initials,
      },
      class: {
        name: classInfo.name,
        phase: classInfo.phase,
      },
      term: {
        name: assessment.term?.name || 'Unknown',
        session: assessment.term?.academicYear?.name || 'Unknown',
      },
      subjects,
      averageScore,
      classPosition,
      totalSubjects: subjects.length,
      teacherRemark,
      principalRemark,
      statistics: {
        highestScore: validScores.length > 0 ? Math.max(...validScores) : 0,
        lowestScore: validScores.length > 0 ? Math.min(...validScores) : 0,
        passRate,
      },
    };
  }

  /**
   * Generate report cards for all students in an assessment
   */
  async generateBulkReportCards(
    assessmentId: string,
    schoolId: string
  ): Promise<ReportCardData[]> {
    // Get assessment
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all results for this assessment
    const results = await this.prisma.result.findMany({
      where: { assessmentId },
      select: { pupilId: true },
      distinct: ['pupilId'],
    });

    // Generate report card for each student
    const reportCards: ReportCardData[] = [];

    for (const result of results) {
      try {
        const reportCard = await this.generateReportCard(
          assessmentId,
          result.pupilId,
          schoolId
        );
        reportCards.push(reportCard);
      } catch (error) {
        console.error(
          `Error generating report card for pupil ${result.pupilId}:`,
          error
        );
      }
    }

    return reportCards;
  }

  /**
   * Get report card summary (for listing)
   */
  async getReportCardSummaries(assessmentId: string, schoolId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        class: true,
        term: { include: { academicYear: true } },
        _count: { select: { results: true } },
      },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all unique students in this assessment
    const results = await this.prisma.result.findMany({
      where: { assessmentId },
      include: {
        pupil: true,
      },
      distinct: ['pupilId'],
    });

    // Get grouped statistics
    const summaries = results.map((result) => ({
      pupilId: result.pupilId,
      pupilName: `${result.pupil.firstName} ${result.pupil.lastName}`,
      admissionNo: result.pupil.admissionNo,
      classPosition: result.classPosition,
      totalScore: result.totalScore,
      grade: result.grade,
    }));

    return {
      assessment: {
        id: assessment.id,
        name: assessment.name,
        status: assessment.status,
        class: assessment.class?.name,
        term: assessment.term?.name,
        session: assessment.term?.academicYear?.name,
      },
      totalStudents: summaries.length,
      summaries: summaries.sort((a, b) => {
        // Sort by class position, then by total score
        if (a.classPosition && b.classPosition) {
          return a.classPosition - b.classPosition;
        }
        return (b.totalScore || 0) - (a.totalScore || 0);
      }),
    };
  }

  /**
   * Calculate class-wide statistics
   */
  async getClassStatistics(assessmentId: string, schoolId: string) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: assessmentId, schoolId },
      include: {
        _count: { select: { results: true } },
      },
    });

    if (!assessment) {
      throw new Error('Assessment not found');
    }

    // Get all results
    const results = await this.prisma.result.findMany({
      where: { assessmentId },
    });

    const scores = results
      .filter((r) => r.totalScore !== null)
      .map((r) => r.totalScore!);

    if (scores.length === 0) {
      return {
        assessmentId,
        totalStudents: 0,
        totalResults: results.length,
        statistics: {
          highestScore: 0,
          lowestScore: 0,
          averageScore: 0,
          medianScore: 0,
          standardDeviation: 0,
          passCount: 0,
          passRate: 0,
          gradeDistribution: {},
        },
      };
    }

    // Calculate statistics
    scores.sort((a, b) => a - b);

    const median =
      scores.length % 2 === 0
        ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
        : scores[Math.floor(scores.length / 2)];

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) /
      scores.length;
    const standardDeviation = Math.sqrt(variance);

    // Grade distribution
    const gradeDistribution: Record<string, number> = {};
    results.forEach((r) => {
      if (r.grade) {
        gradeDistribution[r.grade] = (gradeDistribution[r.grade] || 0) + 1;
      }
    });

    const passCount = scores.filter((s) => s >= 40).length;

    return {
      assessmentId,
      totalStudents: results.length,
      totalResults: results.length,
      statistics: {
        highestScore: Math.max(...scores),
        lowestScore: Math.min(...scores),
        averageScore: Math.round(mean * 100) / 100,
        medianScore: Math.round(median * 100) / 100,
        standardDeviation: Math.round(standardDeviation * 100) / 100,
        passCount,
        passRate: Math.round((passCount / scores.length) * 100 * 100) / 100,
        gradeDistribution,
      },
    };
  }
}

export default ReportCardService;
