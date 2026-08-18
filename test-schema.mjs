import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function test() {
  try {
    console.log('Testing Prisma connection and schema...\n');
    
    // Test basic operations
    const schoolCount = await prisma.school.count();
    console.log(`✓ Schools in database: ${schoolCount}`);
    
    const assessmentCount = await prisma.assessment.count();
    console.log(`✓ Assessments in database: ${assessmentCount}`);
    
    const resultCount = await prisma.result.count();
    console.log(`✓ Results in database: ${resultCount}`);
    
    // Check new models
    const componentCount = await prisma.assessmentComponent.count();
    console.log(`✓ AssessmentComponents in database: ${componentCount}`);
    
    const summaryCount = await prisma.studentTermSummary.count();
    console.log(`✓ StudentTermSummaries in database: ${summaryCount}`);
    
    const sheetCount = await prisma.resultSheet.count();
    console.log(`✓ ResultSheets in database: ${sheetCount}`);
    
    console.log('\n✅ All schema models are accessible and working!');
    console.log('\nSchema consolidation verification: SUCCESS');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

test();
