import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('\n=== RESULTS SYSTEM AUDIT ===\n');

    // Academic Years
    const academicYears = await prisma.academicYear.findMany({
      include: { terms: true, _count: { select: { terms: true } } }
    });
    console.log(`Academic Years: ${academicYears.length}`);
    academicYears.slice(0, 3).forEach(ay => {
      console.log(`  - ${ay.name} (${ay._count.terms} terms)`);
    });

    // Terms
    const terms = await prisma.term.findMany({
      include: { assessments: { select: { id: true, name: true } } },
      take: 5
    });
    console.log(`\nTerms: ${terms.length} (showing first 5)`);
    terms.forEach(term => {
      console.log(`  - ${term.name} (${term.assessments.length} assessments)`);
    });

    // Assessments
    const assessments = await prisma.assessment.findMany({
      include: { 
        _count: { select: { results: true } },
        term: { select: { name: true } }
      },
      take: 10
    });
    console.log(`\nAssessments: ${assessments.length} (showing first 10)`);
    assessments.forEach(a => {
      console.log(`  - ${a.name} (Term: ${a.term.name}, Results: ${a._count.results}, Status: ${a.status}, Phase: ${a.phase})`);
    });

    // Results
    const results = await prisma.result.findMany({
      include: { 
        assessment: { select: { name: true } },
        pupil: { select: { id: true, firstName: true, lastName: true } }
      },
      take: 10
    });
    console.log(`\nResults: ${results.length} (showing first 10)`);
    results.forEach(r => {
      console.log(`  - Pupil: ${r.pupil.firstName} ${r.pupil.lastName} | Assessment: ${r.assessment.name}`);
      console.log(`    Scores: CA=${r.caScore}, Test=${r.testScore}, Exam=${r.examScore}, Total=${r.totalScore}, Grade=${r.grade}, Subject: ${r.subject}`);
    });

    // Classes with pupils
    const classes = await prisma.class.findMany({
      include: { 
        _count: { select: { pupils: true } },
        subjectClasses: { select: { subjectId: true } }
      },
      take: 5
    });
    console.log(`\nClasses: ${classes.length} (showing first 5)`);
    classes.forEach(c => {
      console.log(`  - ${c.name} (Phase: ${c.phase}, Pupils: ${c._count.pupils}, Subjects: ${c.subjectClasses.length})`);
    });

    // Grading Scales
    const allGradingScales = await prisma.gradingScale.findMany();
    const schoolIds = [...new Set(allGradingScales.map(g => g.schoolId))];
    console.log(`\nGrading Scales: ${schoolIds.length} schools have grading scales`);
    
    if (schoolIds.length > 0) {
      const schoolId = schoolIds[0];
      const fullScale = await prisma.gradingScale.findMany({
        where: { schoolId },
        orderBy: { minScore: 'asc' }
      });
      console.log(`\n  Full grading scale for first school (${schoolId}):`);
      fullScale.forEach(g => {
        console.log(`    ${g.minScore}-${g.maxScore} = ${g.grade}`);
      });
    }

    // Check which endpoints exist
    console.log(`\n=== API ENDPOINTS AVAILABLE ===`);
    console.log(`GET  /api/admin/terms - Fetch all terms`);
    console.log(`GET  /api/admin/assessments - Create new assessment`);
    console.log(`GET  /api/admin/results/data - Get assessments for rendering`);
    console.log(`GET  /api/admin/results/{id} - Fetch single assessment with results`);
    console.log(`POST /api/admin/assessments - Create new assessment`);
    console.log(`POST /api/admin/results - Enter/update scores`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
