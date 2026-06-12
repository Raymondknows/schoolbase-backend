import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Default Seeding - Create default grading scales and assessment templates
 * 
 * This ensures every school has a working grading scale:
 * A: 70-100
 * B: 60-69
 * C: 50-59
 * D: 45-49
 * E: 40-44
 * F: 0-39
 */

interface GradingScaleTemplate {
  grade: string;
  minScore: number;
  maxScore: number;
}

const DEFAULT_GRADING_SCALES: GradingScaleTemplate[] = [
  { grade: 'A', minScore: 70, maxScore: 100 },
  { grade: 'B', minScore: 60, maxScore: 69 },
  { grade: 'C', minScore: 50, maxScore: 59 },
  { grade: 'D', minScore: 45, maxScore: 49 },
  { grade: 'E', minScore: 40, maxScore: 44 },
  { grade: 'F', minScore: 0, maxScore: 39 },
];

export async function ensureDefaultGradingScales(
  schoolId: string
): Promise<void> {
  try {
    // Check if school already has grading scales
    const existingScales = await prisma.gradingScale.findMany({
      where: { schoolId },
    });

    if (existingScales.length > 0) {
      console.log(`✓ School ${schoolId} already has ${existingScales.length} grading scales`);
      return;
    }

    // Create default grading scales
    console.log(`Creating default grading scales for school ${schoolId}...`);

    for (const scale of DEFAULT_GRADING_SCALES) {
      await prisma.gradingScale.create({
        data: {
          schoolId,
          grade: scale.grade,
          minScore: scale.minScore,
          maxScore: scale.maxScore,
        },
      });
      console.log(`  ✓ Created grade ${scale.grade} (${scale.minScore}-${scale.maxScore})`);
    }

    console.log(`✅ Default grading scales created successfully`);
  } catch (error) {
    console.error('Error creating default grading scales:', error);
    throw error;
  }
}

export async function ensureDefaultAssessmentConfiguration(
  assessmentId: string
): Promise<void> {
  try {
    const assessment = await prisma.assessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment) {
      throw new Error(`Assessment ${assessmentId} not found`);
    }

    // Check if already configured
    if (assessment.componentData) {
      console.log(`✓ Assessment ${assessmentId} already configured`);
      return;
    }

    // Create default configuration (CA 20%, Test 20%, Exam 60%)
    const defaultConfig = {
      components: [
        {
          id: 'comp-ca',
          name: 'Continuous Assessment',
          maxScore: 20,
          weight: 20,
          sortOrder: 1,
        },
        {
          id: 'comp-test',
          name: 'Test',
          maxScore: 20,
          weight: 20,
          sortOrder: 2,
        },
        {
          id: 'comp-exam',
          name: 'Examination',
          maxScore: 60,
          weight: 60,
          sortOrder: 3,
        },
      ],
    };

    console.log(`Setting default configuration for assessment ${assessmentId}...`);

    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        componentData: JSON.stringify(defaultConfig),
      },
    });

    console.log(`✅ Default configuration applied to assessment ${assessmentId}`);
  } catch (error) {
    console.error('Error setting default assessment configuration:', error);
    throw error;
  }
}

/**
 * Seed function - Run this when initializing a school or assessment
 */
export async function seedDefaults(
  schoolId: string,
  assessmentId?: string
): Promise<void> {
  try {
    console.log('🌱 Starting default seed...');

    // Ensure grading scales
    await ensureDefaultGradingScales(schoolId);

    // Ensure assessment configuration if provided
    if (assessmentId) {
      await ensureDefaultAssessmentConfiguration(assessmentId);
    }

    console.log('✅ Seeding complete');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}

// Export for CLI/API usage
export async function seedFromCLI() {
  const schoolId = process.argv[2];
  const assessmentId = process.argv[3];

  if (!schoolId) {
    console.error('Usage: npx ts-node seed-defaults.ts <schoolId> [assessmentId]');
    process.exit(1);
  }

  try {
    await seedDefaults(schoolId, assessmentId);
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedFromCLI();
}
