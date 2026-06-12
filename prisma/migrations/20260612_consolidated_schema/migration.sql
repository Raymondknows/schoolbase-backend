-- Add advanced results system tables

-- AssessmentComponent table
CREATE TABLE `AssessmentComponent` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `assessmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `componentType` VARCHAR(191) NOT NULL,
    `maxScore` INT NOT NULL,
    `weight` DOUBLE NOT NULL,
    `sortOrder` INT NOT NULL,
    `isOptional` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssessmentComponent_schoolId_idx`(`schoolId`),
    INDEX `AssessmentComponent_assessmentId_idx`(`assessmentId`),
    UNIQUE INDEX `AssessmentComponent_assessmentId_name_key`(`assessmentId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AssessmentTemplate table
CREATE TABLE `AssessmentTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191),
    `applicablePhases` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssessmentTemplate_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `AssessmentTemplate_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SubjectResult table
CREATE TABLE `SubjectResult` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NOT NULL,
    `academicYearId` VARCHAR(191) NOT NULL,
    `totalScore` DOUBLE NOT NULL,
    `averageScore` DOUBLE NOT NULL,
    `grade` VARCHAR(191),
    `position` INT,
    `teacherRemarks` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SubjectResult_classId_termId_idx`(`classId`, `termId`),
    INDEX `SubjectResult_pupilId_termId_idx`(`pupilId`, `termId`),
    INDEX `SubjectResult_position_idx`(`position`),
    UNIQUE INDEX `SubjectResult_pupilId_subjectId_termId_key`(`pupilId`, `subjectId`, `termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ResultSheet table
CREATE TABLE `ResultSheet` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NOT NULL,
    `academicYearId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `submittedBy` VARCHAR(191),
    `submittedAt` DATETIME(3),
    `classTeacherComments` TEXT,
    `classTeacherReviewedBy` VARCHAR(191),
    `classTeacherReviewedAt` DATETIME(3),
    `principalComments` TEXT,
    `principalReviewedBy` VARCHAR(191),
    `principalReviewedAt` DATETIME(3),
    `publishedBy` VARCHAR(191),
    `publishedAt` DATETIME(3),
    `totalAssessments` INT NOT NULL,
    `totalStudents` INT NOT NULL,
    `completionPercentage` INT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ResultSheet_classId_termId_key`(`classId`, `termId`),
    INDEX `ResultSheet_schoolId_termId_idx`(`schoolId`, `termId`),
    INDEX `ResultSheet_status_idx`(`status`),
    INDEX `ResultSheet_academicYearId_idx`(`academicYearId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- StudentTermSummary table
CREATE TABLE `StudentTermSummary` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NOT NULL,
    `academicYearId` VARCHAR(191) NOT NULL,
    `totalScore` DOUBLE NOT NULL,
    `averageScore` DOUBLE NOT NULL,
    `gradePointAverage` DOUBLE,
    `classPosition` INT,
    `classPositionTied` BOOLEAN NOT NULL DEFAULT false,
    `passFailStatus` VARCHAR(191),
    `overallGrade` VARCHAR(191),
    `performanceBand` VARCHAR(191),
    `attendancePercentage` DOUBLE,
    `behaviorGrade` VARCHAR(191),
    `principalRemarks` LONGTEXT,
    `classTeacherRemarks` LONGTEXT,
    `recommendations` LONGTEXT,
    `promotionDecision` VARCHAR(191),
    `promotionToClass` VARCHAR(191),
    `promotionDecidedBy` VARCHAR(191),
    `promotionDecidedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StudentTermSummary_pupilId_termId_key`(`pupilId`, `termId`),
    INDEX `StudentTermSummary_classId_termId_idx`(`classId`, `termId`),
    INDEX `StudentTermSummary_classPosition_idx`(`classPosition`),
    INDEX `StudentTermSummary_schoolId_termId_idx`(`schoolId`, `termId`),
    CONSTRAINT `StudentTermSummary_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE,
    CONSTRAINT `StudentTermSummary_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE,
    CONSTRAINT `StudentTermSummary_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- BehaviourAssessment table
CREATE TABLE `BehaviourAssessment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NOT NULL,
    `behaviours` LONGTEXT NOT NULL,
    `overallRating` VARCHAR(191) NOT NULL,
    `comments` LONGTEXT,
    `ratedBy` VARCHAR(191),
    `ratedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BehaviourAssessment_pupilId_termId_key`(`pupilId`, `termId`),
    INDEX `BehaviourAssessment_classId_termId_idx`(`classId`, `termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PsychomotorAssessment table
CREATE TABLE `PsychomotorAssessment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191) NOT NULL,
    `skills` LONGTEXT NOT NULL,
    `comments` LONGTEXT,
    `ratedBy` VARCHAR(191),
    `ratedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PsychomotorAssessment_pupilId_termId_key`(`pupilId`, `termId`),
    INDEX `PsychomotorAssessment_classId_termId_idx`(`classId`, `termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ResultVerification table
CREATE TABLE `ResultVerification` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `resultSheetId` VARCHAR(191),
    `pupilId` VARCHAR(191),
    `verificationCode` VARCHAR(191) NOT NULL,
    `qrCodeData` LONGTEXT,
    `barcode128` VARCHAR(191),
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3),
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `verifiedAt` DATETIME(3),
    `verifiedBy` VARCHAR(191),
    `verificationCount` INT NOT NULL DEFAULT 0,
    `resultHash` VARCHAR(191),

    UNIQUE INDEX `ResultVerification_verificationCode_key`(`verificationCode`),
    INDEX `ResultVerification_verificationCode_idx`(`verificationCode`),
    INDEX `ResultVerification_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ReportTemplate table
CREATE TABLE `ReportTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `includeSchoolHeader` BOOLEAN NOT NULL DEFAULT true,
    `includeStudentPhoto` BOOLEAN NOT NULL DEFAULT true,
    `includeAttendance` BOOLEAN NOT NULL DEFAULT true,
    `includeBehavior` BOOLEAN NOT NULL DEFAULT true,
    `includePsychomotor` BOOLEAN NOT NULL DEFAULT true,
    `includeRanking` BOOLEAN NOT NULL DEFAULT false,
    `includeTeacherRemarks` BOOLEAN NOT NULL DEFAULT true,
    `includePrincipalRemarks` BOOLEAN NOT NULL DEFAULT true,
    `includePromotionDecision` BOOLEAN NOT NULL DEFAULT true,
    `includeVerificationCode` BOOLEAN NOT NULL DEFAULT true,
    `includeQRCode` BOOLEAN NOT NULL DEFAULT true,
    `headerHtml` LONGTEXT,
    `footerHtml` LONGTEXT,
    `cssStyles` LONGTEXT,
    `displayMode` VARCHAR(191) NOT NULL DEFAULT 'ALL_SUBJECTS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReportTemplate_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PromotionRecord table
CREATE TABLE `PromotionRecord` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `fromClassId` VARCHAR(191) NOT NULL,
    `toClassId` VARCHAR(191),
    `academicYearId` VARCHAR(191) NOT NULL,
    `termId` VARCHAR(191),
    `decision` VARCHAR(191) NOT NULL,
    `rationale` LONGTEXT,
    `decidedBy` VARCHAR(191),
    `decidedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `appealable` BOOLEAN NOT NULL DEFAULT true,
    `appealDeadline` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PromotionRecord_schoolId_academicYearId_idx`(`schoolId`, `academicYearId`),
    INDEX `PromotionRecord_pupilId_idx`(`pupilId`),
    CONSTRAINT `School_PromotionRecord` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE,
    CONSTRAINT `PromotionRecord_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE,
    CONSTRAINT `PromotionRecord_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear` (`id`) ON DELETE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add foreign keys for SubjectResult
ALTER TABLE `SubjectResult` ADD CONSTRAINT `SubjectResult_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE;
ALTER TABLE `SubjectResult` ADD CONSTRAINT `SubjectResult_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject` (`id`) ON DELETE CASCADE;
ALTER TABLE `SubjectResult` ADD CONSTRAINT `SubjectResult_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE CASCADE;

-- Add foreign keys for AssessmentComponent
ALTER TABLE `AssessmentComponent` ADD CONSTRAINT `AssessmentComponent_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE;
ALTER TABLE `AssessmentComponent` ADD CONSTRAINT `AssessmentComponent_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `Assessment` (`id`) ON DELETE CASCADE;

-- Add foreign keys for AssessmentTemplate
ALTER TABLE `AssessmentTemplate` ADD CONSTRAINT `AssessmentTemplate_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE;

-- Add foreign keys for ResultSheet
ALTER TABLE `ResultSheet` ADD CONSTRAINT `ResultSheet_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE;
ALTER TABLE `ResultSheet` ADD CONSTRAINT `ResultSheet_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE CASCADE;
ALTER TABLE `ResultSheet` ADD CONSTRAINT `ResultSheet_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE CASCADE;
ALTER TABLE `ResultSheet` ADD CONSTRAINT `ResultSheet_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear` (`id`) ON DELETE CASCADE;

-- Add foreign keys for BehaviourAssessment
ALTER TABLE `BehaviourAssessment` ADD CONSTRAINT `BehaviourAssessment_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE;
ALTER TABLE `BehaviourAssessment` ADD CONSTRAINT `BehaviourAssessment_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE CASCADE;
ALTER TABLE `BehaviourAssessment` ADD CONSTRAINT `BehaviourAssessment_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE;
ALTER TABLE `BehaviourAssessment` ADD CONSTRAINT `BehaviourAssessment_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE CASCADE;

-- Add foreign keys for PsychomotorAssessment
ALTER TABLE `PsychomotorAssessment` ADD CONSTRAINT `PsychomotorAssessment_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE;
ALTER TABLE `PsychomotorAssessment` ADD CONSTRAINT `PsychomotorAssessment_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class` (`id`) ON DELETE CASCADE;
ALTER TABLE `PsychomotorAssessment` ADD CONSTRAINT `PsychomotorAssessment_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil` (`id`) ON DELETE CASCADE;
ALTER TABLE `PsychomotorAssessment` ADD CONSTRAINT `PsychomotorAssessment_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term` (`id`) ON DELETE CASCADE;

-- Add foreign key for ReportTemplate
ALTER TABLE `ReportTemplate` ADD CONSTRAINT `ReportTemplate_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE;
