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
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        studentEmail: true,
      },
      orderBy: { firstName: 'asc' },
    });

    res.json({
      students: pupils.map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        admissionNo: p.admissionNo,
        email: p.studentEmail,
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

// GET /api/teacher/assessments - Get assessments for teacher's school
router.get('/assessments', async (req: AuthenticatedRequest, res) => {
  try {
    const { schoolId } = req.user!;

    const assessments = await prisma.assessment.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        phase: true,
        status: true,
        createdAt: true,
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

// GET /api/teacher/assessments/:assessmentId - Get assessment with results
router.get('/assessments/:assessmentId', async (req: AuthenticatedRequest, res) => {
  try {
    const { schoolId } = req.user!;
    const { assessmentId } = req.params;

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
          },
        },
      },
    });

    if (!assessment || assessment.schoolId !== schoolId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({
      assessment: {
        id: assessment.id,
        name: assessment.name,
        phase: assessment.phase,
        status: assessment.status,
        results: assessment.results.map((r) => ({
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

// POST /api/teacher/results - Save result scores
router.post('/results', async (req: AuthenticatedRequest, res) => {
  try {
    const { schoolId } = req.user!;
    const { assessmentId, scores } = req.body;

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

    // Bulk upsert results
    const results = await Promise.all(
      scores.map((score: { pupilId: string; caScore?: number; testScore?: number; examScore?: number }) =>
        prisma.result.upsert({
          where: {
            assessmentId_pupilId_subject: {
              assessmentId,
              pupilId: score.pupilId,
              subject: null as any,
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

// GET /api/teacher/messages - Get messages (announcements, notifications, etc.)
router.get('/messages', async (req: AuthenticatedRequest, res) => {
  try {
    const { userId, schoolId } = req.user!;

    // Fetch announcements for the school
    const announcements = await prisma.announcement.findMany({
      where: { schoolId },
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

    // Transform announcements to message format
    const messages = announcements.map((ann: any) => ({
      id: ann.id,
      sender: 'School Administration',
      subject: ann.title,
      body: ann.body,
      timestamp: ann.publishedAt || ann.createdAt,
      read: false,
      type: 'announcement',
    }));

    res.json({
      messages: messages || [],
      total: messages.length,
    });
  } catch (error: any) {
    console.error('Messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
