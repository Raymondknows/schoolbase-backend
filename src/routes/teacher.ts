import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyAuth, requireTeacher, AuthenticatedRequest } from '../middleware/roleAuth.js';

const router = Router();
const prisma = new PrismaClient();

// Apply authentication middleware to all teacher routes
router.use(verifyAuth);
router.use(requireTeacher);

// GET /api/teacher/dashboard - Teacher dashboard data
router.get('/dashboard', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;

    // Get teacher info
    const teacher = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Get school info
    const school = await prisma.school.findUnique({
      where: { id: schoolId! },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        country: true,
      },
    });

    // Get assigned classes
    const teacherClasses = await prisma.teacherClass.findMany({
      where: { teacherId: userId },
      include: {
        class: {
          include: {
            pupils: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    // Get assigned subjects
    const teacherSubjects = await prisma.teacherSubject.findMany({
      where: { teacherId: userId },
      include: {
        subject: true,
      },
    });

    // Calculate total students
    const allStudentIds = new Set<string>();
    teacherClasses.forEach((tc) => {
      tc.class.pupils.forEach((p) => {
        allStudentIds.add(p.id);
      });
    });

    res.json({
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        role: teacher.role,
      },
      school,
      classes: teacherClasses.map((tc) => ({
        id: tc.class.id,
        name: tc.class.name,
        phase: tc.class.phase,
        arm: tc.class.arm,
        studentCount: tc.class.pupils.length,
      })),
      subjects: teacherSubjects.map((ts) => ({
        id: ts.subject.id,
        name: ts.subject.name,
      })),
      totalStudents: allStudentIds.size,
      classCount: teacherClasses.length,
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/classes - Get all classes assigned to teacher
router.get('/classes', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.user!;

    const classes = await prisma.teacherClass.findMany({
      where: { teacherId: userId },
      include: {
        class: {
          include: {
            pupils: true,
          },
        },
      },
    });

    res.json({
      classes: classes.map((tc) => ({
        id: tc.class.id,
        name: tc.class.name,
        phase: tc.class.phase,
        arm: tc.class.arm,
        studentCount: tc.class.pupils.length,
        pupils: tc.class.pupils.map((p) => ({
          id: p.id,
          name: `${p.firstName} ${p.lastName}`,
          admissionNo: p.admissionNo,
          email: p.studentEmail,
        })),
      })),
    });
  } catch (error: any) {
    console.error('Classes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/classes/:classId/students - Get students in a specific class
router.get('/classes/:classId/students', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.user!;
    const { classId } = req.params;

    // Verify teacher has access to this class
    const assignment = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: {
          teacherId: userId,
          classId,
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({ error: 'Unauthorized: Not assigned to this class' });
    }

    const pupils = await prisma.pupil.findMany({
      where: { classId },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            arm: true,
            phase: true,
          },
        },
        guardians: {
          include: {
            guardian: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { firstName: 'asc' },
    });

    res.json({
      students: pupils.map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        admissionNo: p.admissionNo,
        email: p.studentEmail,
        photoUrl: p.photoUrl,
        status: p.isActive ? 'ACTIVE' : 'INACTIVE',
        class: p.class,
        guardians: p.guardians,
      })),
    });
  } catch (error: any) {
    console.error('Students error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/subjects - Get assigned subjects
router.get('/subjects', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId } = req.user!;

    const subjects = await prisma.teacherSubject.findMany({
      where: { teacherId: userId },
      include: {
        subject: true,
      },
    });

    res.json({
      subjects: subjects.map((ts) => ({
        id: ts.subject.id,
        name: ts.subject.name,
      })),
    });
  } catch (error: any) {
    console.error('Subjects error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/assessments - Get assessments for teacher's assigned classes
router.get('/assessments', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;

    // Get teacher's assigned classes
    const teacherClasses = await prisma.teacherClass.findMany({
      where: { teacherId: userId },
      include: {
        class: {
          select: {
            phase: true,
          },
        },
      },
    });

    // Get unique phases from assigned classes
    const phases = Array.from(new Set(teacherClasses.map((tc) => tc.class.phase)));

    if (phases.length === 0) {
      // Teacher has no assigned classes
      return res.json({ assessments: [] });
    }

    // Get assessments matching teacher's class phases
    const assessments = await prisma.assessment.findMany({
      where: {
        schoolId,
        phase: { in: phases },
      },
      select: {
        id: true,
        name: true,
        phase: true,
        status: true,
        createdAt: true,
        term: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            results: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ assessments });
  } catch (error: any) {
    console.error('Assessments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/assessments/:assessmentId - Get assessment with results (supports ?subject=subjectId filter)
router.get('/assessments/:assessmentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { assessmentId } = req.params;
    const { subject } = req.query;

    // Verify teacher is assigned to a class with this assessment's phase
    const teacherClasses = await prisma.teacherClass.findMany({
      where: { teacherId: userId },
      include: {
        class: {
          select: {
            phase: true,
          },
        },
      },
    });

    const phases = Array.from(new Set(teacherClasses.map((tc) => tc.class.phase)));

    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: {
        results: {
          include: {
            pupil: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNo: true,
              },
            },
            subjectRef: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!assessment || assessment.schoolId !== schoolId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Check if teacher is authorized to view this assessment (phase must match)
    if (!phases.includes(assessment.phase)) {
      return res.status(403).json({ error: 'Not authorized to view this assessment' });
    }

    // Filter results by subject if provided
    let filteredResults = assessment.results;
    if (subject && typeof subject === 'string') {
      // Filter by subject name from the subjectRef relation
      filteredResults = assessment.results.filter((r) => 
        r.subjectRef?.name === subject || r.subject === subject
      );
    }

    // Deduplicate by pupilId (keep first occurrence)
    const seenPupils = new Set<string>();
    const uniqueResults = filteredResults.filter((r) => {
      if (seenPupils.has(r.pupilId)) return false;
      seenPupils.add(r.pupilId);
      return true;
    });

    res.json({
      assessment: {
        id: assessment.id,
        name: assessment.name,
        phase: assessment.phase,
        status: assessment.status,
        results: uniqueResults.map((r) => ({
          id: r.id,
          pupilId: r.pupil.id,
          pupilName: `${r.pupil.firstName} ${r.pupil.lastName}`,
          admissionNo: r.pupil.admissionNo,
          caScore: r.caScore,
          testScore: r.testScore,
          examScore: r.examScore,
          totalScore: r.totalScore,
          grade: r.grade,
        })),
      },
    });
  } catch (error: any) {
    console.error('Assessment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/classes/:classId/assessments - Get assessments for a specific class assigned to teacher
router.get('/classes/:classId/assessments', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { classId } = req.params;

    // Verify teacher is assigned to this class
    const assignment = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: {
          teacherId: userId,
          classId,
        },
      },
      include: {
        class: true,
      },
    });

    if (!assignment) {
      return res.status(403).json({ error: 'Unauthorized: Not assigned to this class' });
    }

    // Get current academic year and term
    const currentTerm = await prisma.term.findFirst({
      where: {
        academicYear: {
          schoolId,
          isCurrent: true,
        },
      },
    });

    if (!currentTerm) {
      return res.json({ assessments: [] });
    }

    // Get assessments for this class's phase and current term
    const assessments = await prisma.assessment.findMany({
      where: {
        schoolId,
        phase: assignment.class.phase,
        termId: currentTerm.id,
        status: { in: ['APPROVED', 'PUBLISHED'] }, // Only show approved/published assessments
      },
      select: {
        id: true,
        name: true,
        phase: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            results: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ 
      assessments: assessments.map((a) => ({
        id: a.id,
        title: a.name,
        type: a.phase,
        status: a.status,
        createdAt: a.createdAt,
        resultsCount: a._count.results,
      })),
    });
  } catch (error: any) {
    console.error('Class assessments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/results/:classId - Get existing results for a class
router.get('/results/:classId', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { classId } = req.params;

    // Verify teacher is assigned to this class
    const assignment = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: {
          teacherId: userId,
          classId,
        },
      },
      include: {
        class: true,
      },
    });

    if (!assignment) {
      return res.status(403).json({ error: 'Unauthorized: Not assigned to this class' });
    }

    // Get all results for this class's assessments
    const results = await prisma.result.findMany({
      where: {
        assessment: {
          schoolId,
          phase: assignment.class.phase,
        },
      },
      include: {
        assessment: {
          select: {
            id: true,
            termId: true,
          },
        },
      },
    });

    res.json({ 
      results: results.map((r) => ({
        id: r.id,
        studentId: r.pupilId,
        assessmentId: r.assessmentId,
        caScore: r.caScore,
        testScore: r.testScore,
        examScore: r.examScore,
        totalScore: r.totalScore,
        grade: r.grade,
        score: r.totalScore, // Also include for compatibility
      })),
    });
  } catch (error: any) {
    console.error('Results error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/teacher/results - Save result scores (supports optional subject parameter)
router.post('/results', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { assessmentId, scores, subject } = req.body;

    if (!assessmentId || !Array.isArray(scores)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify assessment belongs to teacher's school
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment || assessment.schoolId !== schoolId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // If subject is specified, verify teacher is assigned to it
    if (subject && typeof subject === 'string') {
      const teacherSubjectAssignment = await prisma.teacherSubject.findFirst({
        where: {
          teacherId: userId,
          schoolId,
          subject: {
            name: subject,
          },
        },
      });

      if (!teacherSubjectAssignment) {
        return res.status(403).json({ error: `Not authorized to score subject: ${subject}` });
      }
    }

    // Bulk upsert results
    const results = await Promise.all(
      scores.map((score: { pupilId: string; caScore?: number; testScore?: number; examScore?: number }) =>
        prisma.result.upsert({
          where: {
            assessmentId_pupilId_subject: {
              assessmentId,
              pupilId: score.pupilId,
              subject: subject || null,
            },
          },
          update: {
            caScore: score.caScore,
            testScore: score.testScore,
            examScore: score.examScore,
          },
          create: {
            assessmentId,
            pupilId: score.pupilId,
            subject: subject || null,
            caScore: score.caScore,
            testScore: score.testScore,
            examScore: score.examScore,
          },
        })
      )
    );

    res.json({ success: true, results });
  } catch (error: any) {
    console.error('Results save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/teacher/attendance - Save attendance records
router.post('/attendance', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { classId, date, attendanceData } = req.body;

    if (!classId || !date || !Array.isArray(attendanceData)) {
      return res.status(400).json({ error: 'classId, date, and attendanceData array required' });
    }

    // Verify teacher is assigned to this class
    const assignment = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: {
          teacherId: userId,
          classId,
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({ error: 'Unauthorized: Not assigned to this class' });
    }

    // Parse date
    const attendanceDate = new Date(date);
    attendanceDate.setUTCHours(0, 0, 0, 0);

    // Validate attendance statuses
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
    for (const att of attendanceData) {
      if (!validStatuses.includes(att.status)) {
        return res.status(400).json({ error: `Invalid status: ${att.status}` });
      }
    }

    // Delete existing records for this date and class
    await prisma.attendanceRecord.deleteMany({
      where: {
        schoolId,
        classId,
        date: attendanceDate,
      },
    });

    // Create new attendance records
    const records = await Promise.all(
      attendanceData.map((att: { studentId?: string; pupilId?: string; status: string }) => {
        const pupilId = att.pupilId || att.studentId;
        if (!pupilId) {
          throw new Error('pupilId or studentId required for each attendance record');
        }
        return prisma.attendanceRecord.create({
          data: {
            schoolId,
            classId,
            pupilId: pupilId!, // Non-null assertion after validation
            date: attendanceDate,
            status: att.status as any,
          },
        });
      })
    );

    res.status(201).json({
      success: true,
      message: `Marked attendance for ${records.length} students`,
      recordsCreated: records.length,
    });
  } catch (error: any) {
    console.error('Error marking attendance:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// GET /api/teacher/attendance/summary?classId=X&startDate=Y&endDate=Z - Get attendance summary for a date range
router.get('/attendance/summary', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { classId, startDate, endDate } = req.query;

    if (!classId || !startDate || !endDate) {
      return res.status(400).json({ error: 'classId, startDate, and endDate query parameters required' });
    }

    // Verify teacher is assigned to this class
    const assignment = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: {
          teacherId: userId,
          classId: classId as string,
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({ error: 'Unauthorized: Not assigned to this class' });
    }

    // Parse dates
    const start = new Date(startDate as string);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate as string);
    end.setUTCHours(0, 0, 0, 0);

    // Fetch students in the class
    const students = await prisma.pupil.findMany({
      where: {
        schoolId,
        classId: classId as string,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
      },
      orderBy: { firstName: 'asc' },
    });

    // Fetch attendance records for the date range
    const attendanceRecords = await prisma.attendanceRecord.findMany({
      where: {
        schoolId,
        classId: classId as string,
        date: {
          gte: start,
          lte: end,
        },
      },
      select: {
        pupilId: true,
        date: true,
        status: true,
      },
    });

    // Group attendance by student and date
    const attendanceByStudent: Record<string, Record<string, { status: string }>> = {};
    
    students.forEach((student) => {
      attendanceByStudent[student.id] = {};
    });

    attendanceRecords.forEach((record) => {
      const dateStr = record.date.toISOString().split('T')[0];
      if (!attendanceByStudent[record.pupilId]) {
        attendanceByStudent[record.pupilId] = {};
      }
      attendanceByStudent[record.pupilId][dateStr] = {
        status: record.status,
      };
    });

    // Format response
    const formattedStudents = students.map((student) => ({
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      admissionNo: student.admissionNo,
      attendance: attendanceByStudent[student.id],
    }));

    res.json({
      students: formattedStudents,
      dateRange: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
    });
  } catch (error: any) {
    console.error('Error fetching attendance summary:', error);
    res.status(500).json({ error: 'Failed to fetch attendance summary' });
  }
});

// GET /api/teacher/attendance/check - Check if attendance already taken for a date
router.get('/attendance/check', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;
    const { classId, date } = req.query;

    if (!classId || !date) {
      return res.status(400).json({ error: 'classId and date required' });
    }

    // Verify teacher is assigned to this class
    const assignment = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: {
          teacherId: userId,
          classId: classId as string,
        },
      },
    });

    if (!assignment) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Parse date
    const checkDate = new Date(date as string);
    checkDate.setUTCHours(0, 0, 0, 0);

    // Check if attendance exists for this date
    const existingAttendance = await prisma.attendanceRecord.findMany({
      where: {
        schoolId,
        classId: classId as string,
        date: checkDate,
      },
      select: { pupilId: true, status: true },
    });

    res.json({
      exists: existingAttendance.length > 0,
      count: existingAttendance.length,
      submittedDate: existingAttendance.length > 0 ? checkDate.toISOString().split('T')[0] : null,
    });
  } catch (error: any) {
    console.error('Error checking attendance:', error);
    res.status(500).json({ error: 'Failed to check attendance' });
  }
});

// GET /api/teacher/profile - Get teacher profile
router.get('/profile', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;

    const teacher = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const school = await prisma.school.findUnique({
      where: { id: schoolId! },
      select: { name: true, slug: true },
    });

    res.json({
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      role: teacher.role,
      school,
      createdAt: teacher.createdAt,
    });
  } catch (error: any) {
    console.error('Profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/teacher/announcements - Get announcements for teacher dashboard
router.get('/announcements', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;

    // Fetch announcements for the school
    const announcements = await prisma.announcement.findMany({
      where: { 
        schoolId,
        published: true,
      },
      select: {
        id: true,
        title: true,
        body: true,
        publishedAt: true,
        createdAt: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });

    res.json({
      announcements: announcements || [],
      total: announcements.length,
    });
  } catch (error: any) {
    console.error('Messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
