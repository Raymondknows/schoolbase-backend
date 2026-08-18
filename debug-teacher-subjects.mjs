import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // Get all teachers
    const teachers = await prisma.user.findMany({
      where: { role: 'TEACHER' },
      select: { id: true, name: true, email: true, schoolId: true }
    });

    console.log('\n=== TEACHERS ===');
    console.log(`Total: ${teachers.length}`);
    teachers.forEach(t => console.log(`  ${t.name} (${t.email}) - School: ${t.schoolId}, ID: ${t.id}`));

    // Get all subjects
    const subjects = await prisma.subject.findMany({
      select: { id: true, name: true, schoolId: true }
    });

    console.log('\n=== SUBJECTS ===');
    console.log(`Total: ${subjects.length}`);
    subjects.forEach(s => console.log(`  ${s.name} (${s.id}) - School: ${s.schoolId}`));

    // Get all teacher-subject assignments
    const assignments = await prisma.teacherSubject.findMany({
      select: { 
        id: true,
        teacherId: true,
        subjectId: true,
        schoolId: true,
        teacher: { select: { name: true } },
        subject: { select: { name: true } }
      }
    });

    console.log('\n=== TEACHER-SUBJECT ASSIGNMENTS ===');
    console.log(`Total: ${assignments.length}`);
    assignments.forEach(a => console.log(`  ${a.teacher.name} -> ${a.subject.name}`));

    if (teachers.length > 0 && assignments.length === 0) {
      console.log('\n⚠️  WARNING: Teachers exist but no subject assignments found!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
