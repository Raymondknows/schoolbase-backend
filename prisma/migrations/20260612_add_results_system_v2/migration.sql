-- CreateEnum ResultStatus
CREATE TYPE "ResultStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CLASS_TEACHER_REVIEW', 'ADMIN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum AssessmentComponentType
CREATE TYPE "AssessmentComponentType" AS ENUM ('CA', 'ASSIGNMENT', 'QUIZ', 'PROJECT', 'PRACTICAL', 'MIDTERM', 'EXAM', 'PARTICIPATION', 'OTHER');

-- CreateEnum PromotionDecision
CREATE TYPE "PromotionDecision" AS ENUM ('PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED');

-- CreateEnum BehaviourRating
CREATE TYPE "BehaviourRating" AS ENUM ('EXCELLENT', 'VERY_GOOD', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT');

-- CreateEnum SchoolPhase
CREATE TYPE "SchoolPhase" AS ENUM ('EARLY_YEARS', 'PRIMARY', 'SECONDARY');

-- STEP 1: Add new columns to Result table
ALTER TABLE `Result`
ADD COLUMN `scores` JSON,
ADD COLUMN `feedback` TEXT,
ADD COLUMN `totalScore` FLOAT,
ADD COLUMN `classId` VARCHAR(36),
ADD COLUMN `updatedBy` VARCHAR(36),
ADD COLUMN `deletedAt` DATETIME(3),
ADD COLUMN `status` VARCHAR(50) DEFAULT 'DRAFT';

-- STEP 2: Migrate data from old score fields to JSON
UPDATE `Result` SET `scores` = JSON_OBJECT(
  'ca', COALESCE(`caScore`, 0),
  'test', COALESCE(`testScore`, 0),
  'exam', COALESCE(`examScore`, 0)
)
WHERE `scores` IS NULL;

-- STEP 3: Calculate totalScore from old fields
UPDATE `Result` SET `totalScore` = 
  COALESCE(`caScore`, 0) * 0.2 + 
  COALESCE(`testScore`, 0) * 0.3 + 
  COALESCE(`examScore`, 0) * 0.5
WHERE `totalScore` IS NULL AND `scores` IS NOT NULL;

-- STEP 4: Populate feedback from comment
UPDATE `Result` SET `feedback` = `comment` WHERE `feedback` IS NULL AND `comment` IS NOT NULL;

-- STEP 5: Populate classId from pupil.classId
UPDATE `Result` r 
INNER JOIN `Pupil` p ON r.`pupilId` = p.`id`
SET r.`classId` = p.`classId`
WHERE r.`classId` IS NULL;

-- STEP 6: Add missing indexes to Result
CREATE INDEX `Result_assessmentId_idx` ON `Result`(`assessmentId`);
CREATE INDEX `Result_pupilId_idx` ON `Result`(`pupilId`);
CREATE INDEX `Result_subjectId_idx` ON `Result`(`subjectId`);
CREATE INDEX `Result_publishedAt_idx` ON `Result`(`publishedAt`);
CREATE INDEX `Result_classId_idx` ON `Result`(`classId`);
CREATE INDEX `Result_deletedAt_idx` ON `Result`(`deletedAt`);

-- STEP 7: Add new columns to Assessment table
ALTER TABLE `Assessment`
ADD COLUMN `classId` VARCHAR(36),
ADD COLUMN `description` TEXT,
ADD COLUMN `dueDate` DATETIME(3),
ADD COLUMN `createdBy` VARCHAR(36),
ADD COLUMN `updatedAt` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- STEP 8: Add index to Assessment
CREATE INDEX `Assessment_schoolId_termId_status_idx` ON `Assessment`(`schoolId`, `termId`, `status`);

-- STEP 9: Add new columns to GradingScale table
ALTER TABLE `GradingScale`
ADD COLUMN `phase` ENUM('EARLY_YEARS', 'PRIMARY', 'SECONDARY'),
ADD COLUMN `name` VARCHAR(255) DEFAULT 'Default Scale',
ADD COLUMN `version` INT DEFAULT 1,
ADD COLUMN `effectiveFrom` DATETIME(3),
ADD COLUMN `effectiveUntil` DATETIME(3),
ADD COLUMN `isActive` BOOLEAN DEFAULT TRUE,
ADD COLUMN `gradePoint` FLOAT;

-- STEP 10: Add updatedAt to User table
ALTER TABLE `User`
ADD COLUMN `updatedAt` DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- STEP 11: Create AssessmentComponent table (NEW)
CREATE TABLE `AssessmentComponent` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `assessmentId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `componentType` ENUM('CA', 'ASSIGNMENT', 'QUIZ', 'PROJECT', 'PRACTICAL', 'MIDTERM', 'EXAM', 'PARTICIPATION', 'OTHER') NOT NULL,
  `maxScore` FLOAT NOT NULL,
  `weight` FLOAT NOT NULL,
  `sortOrder` INT DEFAULT 0,
  `isOptional` BOOLEAN DEFAULT FALSE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `AssessmentComponent_schoolId_idx` (`schoolId`),
  KEY `AssessmentComponent_assessmentId_idx` (`assessmentId`),
  CONSTRAINT `AssessmentComponent_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AssessmentComponent_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `Assessment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 12: Create AssessmentTemplate table (NEW)
CREATE TABLE `AssessmentTemplate` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `components` JSON,
  `applicablePhases` JSON,
  `isActive` BOOLEAN DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `AssessmentTemplate_schoolId_idx` (`schoolId`),
  CONSTRAINT `AssessmentTemplate_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 13: Create SubjectResult table (NEW)
CREATE TABLE `SubjectResult` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `classId` VARCHAR(36) NOT NULL,
  `pupilId` VARCHAR(36) NOT NULL,
  `subjectId` VARCHAR(36) NOT NULL,
  `termId` VARCHAR(36) NOT NULL,
  `academicYearId` VARCHAR(36) NOT NULL,
  `totalScore` FLOAT,
  `averageScore` FLOAT,
  `grade` VARCHAR(5),
  `position` INT,
  `teacherRemarks` TEXT,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `SubjectResult_pupilId_subjectId_termId_key` (`pupilId`, `subjectId`, `termId`),
  KEY `SubjectResult_schoolId_idx` (`schoolId`),
  KEY `SubjectResult_classId_idx` (`classId`),
  KEY `SubjectResult_subjectId_idx` (`subjectId`),
  KEY `SubjectResult_termId_idx` (`termId`),
  CONSTRAINT `SubjectResult_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SubjectResult_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SubjectResult_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SubjectResult_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SubjectResult_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SubjectResult_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 14: Create ResultSheet table (NEW)
CREATE TABLE `ResultSheet` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `classId` VARCHAR(36) NOT NULL,
  `termId` VARCHAR(36) NOT NULL,
  `academicYearId` VARCHAR(36) NOT NULL,
  `assessmentId` VARCHAR(36),
  `status` ENUM('DRAFT', 'SUBMITTED', 'CLASS_TEACHER_REVIEW', 'ADMIN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED') DEFAULT 'DRAFT',
  `submittedBy` VARCHAR(36),
  `submittedAt` DATETIME(3),
  `classTeacherComments` TEXT,
  `classTeacherReviewedBy` VARCHAR(36),
  `classTeacherReviewedAt` DATETIME(3),
  `principalComments` TEXT,
  `principalReviewedBy` VARCHAR(36),
  `principalReviewedAt` DATETIME(3),
  `publishedBy` VARCHAR(36),
  `publishedAt` DATETIME(3),
  `totalAssessments` INT DEFAULT 0,
  `totalStudents` INT DEFAULT 0,
  `completionPercentage` FLOAT DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ResultSheet_schoolId_idx` (`schoolId`),
  KEY `ResultSheet_classId_idx` (`classId`),
  KEY `ResultSheet_termId_idx` (`termId`),
  KEY `ResultSheet_status_idx` (`status`),
  CONSTRAINT `ResultSheet_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ResultSheet_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ResultSheet_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ResultSheet_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ResultSheet_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `Assessment` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 15: Create StudentTermSummary table (NEW)
CREATE TABLE `StudentTermSummary` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `classId` VARCHAR(36) NOT NULL,
  `pupilId` VARCHAR(36) NOT NULL,
  `termId` VARCHAR(36) NOT NULL,
  `academicYearId` VARCHAR(36) NOT NULL,
  `totalScore` FLOAT,
  `averageScore` FLOAT,
  `gradePointAverage` FLOAT,
  `classPosition` INT,
  `passFailStatus` VARCHAR(20),
  `overallGrade` VARCHAR(5),
  `performanceBand` VARCHAR(50),
  `attendancePercentage` FLOAT,
  `behaviorGrade` VARCHAR(5),
  `principalRemarks` TEXT,
  `classTeacherRemarks` TEXT,
  `promotionDecision` ENUM('PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED'),
  `promotionToClass` VARCHAR(36),
  `promotionDecidedBy` VARCHAR(36),
  `promotionDecidedAt` DATETIME(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `StudentTermSummary_pupilId_termId_key` (`pupilId`, `termId`),
  KEY `StudentTermSummary_schoolId_idx` (`schoolId`),
  KEY `StudentTermSummary_classId_idx` (`classId`),
  KEY `StudentTermSummary_termId_idx` (`termId`),
  CONSTRAINT `StudentTermSummary_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StudentTermSummary_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StudentTermSummary_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `StudentTermSummary_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `StudentTermSummary_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 16: Create BehaviourAssessment table (NEW)
CREATE TABLE `BehaviourAssessment` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `classId` VARCHAR(36) NOT NULL,
  `pupilId` VARCHAR(36) NOT NULL,
  `termId` VARCHAR(36) NOT NULL,
  `behaviours` JSON NOT NULL,
  `overallRating` ENUM('EXCELLENT', 'VERY_GOOD', 'GOOD', 'SATISFACTORY', 'NEEDS_IMPROVEMENT'),
  `comments` TEXT,
  `ratedBy` VARCHAR(36),
  `ratedAt` DATETIME(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `BehaviourAssessment_pupilId_termId_key` (`pupilId`, `termId`),
  KEY `BehaviourAssessment_schoolId_idx` (`schoolId`),
  KEY `BehaviourAssessment_classId_idx` (`classId`),
  KEY `BehaviourAssessment_termId_idx` (`termId`),
  CONSTRAINT `BehaviourAssessment_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `BehaviourAssessment_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `BehaviourAssessment_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `BehaviourAssessment_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 17: Create PsychomotorAssessment table (NEW)
CREATE TABLE `PsychomotorAssessment` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `classId` VARCHAR(36) NOT NULL,
  `pupilId` VARCHAR(36) NOT NULL,
  `termId` VARCHAR(36) NOT NULL,
  `skills` JSON NOT NULL,
  `comments` TEXT,
  `ratedBy` VARCHAR(36),
  `ratedAt` DATETIME(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `PsychomotorAssessment_pupilId_termId_key` (`pupilId`, `termId`),
  KEY `PsychomotorAssessment_schoolId_idx` (`schoolId`),
  KEY `PsychomotorAssessment_classId_idx` (`classId`),
  KEY `PsychomotorAssessment_termId_idx` (`termId`),
  CONSTRAINT `PsychomotorAssessment_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PsychomotorAssessment_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PsychomotorAssessment_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PsychomotorAssessment_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 18: Create ResultVerification table (NEW)
CREATE TABLE `ResultVerification` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `resultSheetId` VARCHAR(36) NOT NULL,
  `pupilId` VARCHAR(36) NOT NULL,
  `verificationCode` VARCHAR(100) UNIQUE NOT NULL,
  `qrCodeData` JSON,
  `barcode128` VARCHAR(255),
  `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3),
  `isVerified` BOOLEAN DEFAULT FALSE,
  `verifiedAt` DATETIME(3),
  `verifiedBy` VARCHAR(36),
  `verificationCount` INT DEFAULT 0,
  `resultHash` VARCHAR(255),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ResultVerification_verificationCode_key` (`verificationCode`),
  KEY `ResultVerification_schoolId_idx` (`schoolId`),
  KEY `ResultVerification_resultSheetId_idx` (`resultSheetId`),
  KEY `ResultVerification_pupilId_idx` (`pupilId`),
  CONSTRAINT `ResultVerification_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ResultVerification_resultSheetId_fkey` FOREIGN KEY (`resultSheetId`) REFERENCES `ResultSheet` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ResultVerification_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 19: Create ReportTemplate table (NEW)
CREATE TABLE `ReportTemplate` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `isDefault` BOOLEAN DEFAULT FALSE,
  `includeSchoolHeader` BOOLEAN DEFAULT TRUE,
  `includeStudentPhoto` BOOLEAN DEFAULT FALSE,
  `includeAttendance` BOOLEAN DEFAULT TRUE,
  `includeBehavior` BOOLEAN DEFAULT TRUE,
  `includePsychomotor` BOOLEAN DEFAULT FALSE,
  `includeRanking` BOOLEAN DEFAULT TRUE,
  `includeTeacherRemarks` BOOLEAN DEFAULT TRUE,
  `includePrincipalRemarks` BOOLEAN DEFAULT FALSE,
  `includePromotionDecision` BOOLEAN DEFAULT FALSE,
  `includeVerificationCode` BOOLEAN DEFAULT FALSE,
  `includeQRCode` BOOLEAN DEFAULT FALSE,
  `displayMode` VARCHAR(50) DEFAULT 'ALL_SUBJECTS',
  `headerHtml` LONGTEXT,
  `footerHtml` LONGTEXT,
  `cssStyles` LONGTEXT,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ReportTemplate_schoolId_idx` (`schoolId`),
  CONSTRAINT `ReportTemplate_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- STEP 20: Create PromotionRecord table (NEW)
CREATE TABLE `PromotionRecord` (
  `id` VARCHAR(36) NOT NULL,
  `schoolId` VARCHAR(36) NOT NULL,
  `pupilId` VARCHAR(36) NOT NULL,
  `fromClassId` VARCHAR(36) NOT NULL,
  `toClassId` VARCHAR(36),
  `academicYearId` VARCHAR(36) NOT NULL,
  `termId` VARCHAR(36),
  `decision` ENUM('PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED') NOT NULL,
  `rationale` TEXT,
  `decidedBy` VARCHAR(36),
  `decidedAt` DATETIME(3),
  `appealable` BOOLEAN DEFAULT FALSE,
  `appealDeadline` DATETIME(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `PromotionRecord_schoolId_idx` (`schoolId`),
  KEY `PromotionRecord_pupilId_idx` (`pupilId`),
  KEY `PromotionRecord_fromClassId_idx` (`fromClassId`),
  KEY `PromotionRecord_academicYearId_idx` (`academicYearId`),
  CONSTRAINT `PromotionRecord_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PromotionRecord_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PromotionRecord_fromClassId_fkey` FOREIGN KEY (`fromClassId`) REFERENCES `Class` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PromotionRecord_toClassId_fkey` FOREIGN KEY (`toClassId`) REFERENCES `Class` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `PromotionRecord_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- VALIDATION QUERIES (These succeed = migration was successful)
-- SELECT 'Migration successful!' as status;
-- Check for NULL scores
-- SELECT COUNT(*) as missing_scores FROM `Result` WHERE `scores` IS NULL AND `caScore` IS NOT NULL;
-- Check totalScore calculation
-- SELECT COUNT(*) as missing_totals FROM `Result` WHERE `totalScore` IS NULL AND `scores` IS NOT NULL;
