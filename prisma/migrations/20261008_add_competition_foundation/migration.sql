-- CreateTable
CREATE TABLE `CompetitionPupilAccount` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `linkedByUserId` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `linkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `CompetitionPupilAccount_pupilId_key`(`pupilId`),
    UNIQUE INDEX `CompetitionPupilAccount_userId_key`(`userId`),
    INDEX `CompetitionPupilAccount_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `CompetitionPupilAccount_linkedByUserId_idx`(`linkedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionCategory` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `subjectId` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `countryCode` VARCHAR(2) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionCategory_subjectId_idx`(`subjectId`),
    INDEX `CompetitionCategory_countryCode_isActive_idx`(`countryCode`, `isActive`),
    UNIQUE INDEX `CompetitionCategory_schoolId_code_key`(`schoolId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionQuestionSet` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `gradeLabel` VARCHAR(191) NULL,
    `topic` VARCHAR(191) NULL,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'en',
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `createdByUserId` VARCHAR(191) NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionQuestionSet_categoryId_status_gradeLabel_idx`(`categoryId`, `status`, `gradeLabel`),
    INDEX `CompetitionQuestionSet_subjectId_idx`(`subjectId`),
    INDEX `CompetitionQuestionSet_status_createdAt_idx`(`status`, `createdAt`),
    UNIQUE INDEX `CompetitionQuestionSet_schoolId_name_version_key`(`schoolId`, `name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `questionSetId` VARCHAR(191) NOT NULL,
    `type` ENUM('MULTIPLE_CHOICE', 'TRUE_FALSE', 'IMAGE', 'ORDERING', 'MATCHING', 'SHORT_ANSWER') NOT NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD', 'EXPERT') NOT NULL DEFAULT 'MEDIUM',
    `prompt` LONGTEXT NOT NULL,
    `explanation` LONGTEXT NULL,
    `basePoints` INTEGER NOT NULL DEFAULT 100,
    `timeLimitSeconds` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `createdByUserId` VARCHAR(191) NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionQuestion_questionSetId_status_difficulty_idx`(`questionSetId`, `status`, `difficulty`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionQuestionOption` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `isCorrect` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionQuestionOption_questionId_idx`(`questionId`),
    UNIQUE INDEX `CompetitionQuestionOption_questionId_sortOrder_key`(`questionId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionQuestionMedia` (
    `id` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `assetUrl` VARCHAR(2048) NOT NULL,
    `storageKey` VARCHAR(512) NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `altText` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionQuestionMedia_questionId_sortOrder_idx`(`questionId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionScoringPolicy` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `policyJson` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionScoringPolicy_isActive_createdAt_idx`(`isActive`, `createdAt`),
    UNIQUE INDEX `CompetitionScoringPolicy_name_version_key`(`name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `questionSetId` VARCHAR(191) NOT NULL,
    `scoringPolicyId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `academicYearId` VARCHAR(191) NULL,
    `termId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `gradeLabel` VARCHAR(191) NULL,
    `questionCount` INTEGER NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `difficultyMixJson` LONGTEXT NULL,
    `eligibilityJson` LONGTEXT NULL,
    `xpPolicyJson` LONGTEXT NULL,
    `attemptLimit` INTEGER NOT NULL DEFAULT 1,
    `opensAt` DATETIME(3) NULL,
    `closesAt` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionChallenge_schoolId_status_opensAt_closesAt_idx`(`schoolId`, `status`, `opensAt`, `closesAt`),
    INDEX `CompetitionChallenge_categoryId_status_idx`(`categoryId`, `status`),
    INDEX `CompetitionChallenge_classId_status_idx`(`classId`, `status`),
    INDEX `CompetitionChallenge_academicYearId_termId_idx`(`academicYearId`, `termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionChallengeAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `challengeId` VARCHAR(191) NOT NULL,
    `academicYearId` VARCHAR(191) NULL,
    `termId` VARCHAR(191) NULL,
    `scoringPolicyId` VARCHAR(191) NOT NULL,
    `status` ENUM('CREATED', 'STARTED', 'SUBMITTED', 'EXPIRED', 'ABANDONED', 'INVALIDATED') NOT NULL DEFAULT 'CREATED',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `deadlineAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `score` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `questionCount` INTEGER NOT NULL DEFAULT 0,
    `elapsedMs` INTEGER NULL,
    `accuracyPercent` DECIMAL(7, 4) NULL,
    `scoringPolicyVersion` INTEGER NOT NULL,
    `scoringSnapshotJson` LONGTEXT NOT NULL,
    `invalidationReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompetitionChallengeAttempt_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CompetitionChallengeAttempt_schoolId_status_createdAt_idx`(`schoolId`, `status`, `createdAt`),
    INDEX `CompetitionChallengeAttempt_pupilId_createdAt_idx`(`pupilId`, `createdAt`),
    INDEX `CompetitionChallengeAttempt_challengeId_status_idx`(`challengeId`, `status`),
    INDEX `CompetitionChallengeAttempt_classId_createdAt_idx`(`classId`, `createdAt`),
    INDEX `CompetitionChallengeAttempt_academicYearId_termId_idx`(`academicYearId`, `termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionAttemptQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `attemptId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `questionVersion` INTEGER NOT NULL,
    `optionOrderJson` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionAttemptQuestion_questionId_idx`(`questionId`),
    UNIQUE INDEX `CompetitionAttemptQuestion_attemptId_position_key`(`attemptId`, `position`),
    UNIQUE INDEX `CompetitionAttemptQuestion_attemptId_questionId_key`(`attemptId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionAnswerSubmission` (
    `id` VARCHAR(191) NOT NULL,
    `attemptId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `responseJson` LONGTEXT NOT NULL,
    `isCorrect` BOOLEAN NOT NULL,
    `awardedPoints` INTEGER NOT NULL DEFAULT 0,
    `elapsedMs` INTEGER NULL,
    `answeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionAnswerSubmission_attemptId_answeredAt_idx`(`attemptId`, `answeredAt`),
    UNIQUE INDEX `CompetitionAnswerSubmission_attemptId_questionId_key`(`attemptId`, `questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionStudentChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `challengeId` VARCHAR(191) NOT NULL,
    `senderPupilId` VARCHAR(191) NOT NULL,
    `recipientPupilId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionStudentChallenge_recipientPupilId_status_expiresA_idx`(`recipientPupilId`, `status`, `expiresAt`),
    INDEX `CompetitionStudentChallenge_senderPupilId_createdAt_idx`(`senderPupilId`, `createdAt`),
    INDEX `CompetitionStudentChallenge_challengeId_status_idx`(`challengeId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionXpTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `attemptId` VARCHAR(191) NULL,
    `sourceType` VARCHAR(80) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CompetitionXpTransaction_idempotencyKey_key`(`idempotencyKey`),
    INDEX `CompetitionXpTransaction_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `CompetitionXpTransaction_pupilId_createdAt_idx`(`pupilId`, `createdAt`),
    INDEX `CompetitionXpTransaction_sourceType_sourceId_idx`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionAchievement` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `criteriaJson` LONGTEXT NOT NULL,
    `iconUrl` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompetitionAchievement_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionPupilAchievement` (
    `id` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `achievementId` VARCHAR(191) NOT NULL,
    `awardedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceType` VARCHAR(80) NULL,
    `sourceId` VARCHAR(191) NULL,

    INDEX `CompetitionPupilAchievement_achievementId_awardedAt_idx`(`achievementId`, `awardedAt`),
    UNIQUE INDEX `CompetitionPupilAchievement_pupilId_achievementId_key`(`pupilId`, `achievementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionLeaderboardSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `scope` ENUM('STUDENT', 'CLASS', 'SCHOOL', 'TOURNAMENT', 'REGION', 'COUNTRY') NOT NULL,
    `scopeKey` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `policyVersion` INTEGER NOT NULL,
    `entriesJson` LONGTEXT NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionLeaderboardSnapshot_scope_scopeKey_generatedAt_idx`(`scope`, `scopeKey`, `generatedAt`),
    INDEX `CompetitionLeaderboardSnapshot_schoolId_scope_generatedAt_idx`(`schoolId`, `scope`, `generatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionTournament` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` LONGTEXT NULL,
    `rules` LONGTEXT NULL,
    `status` ENUM('DRAFT', 'UPCOMING', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `scope` ENUM('SCHOOL', 'CLASS', 'DISTRICT', 'REGION', 'COUNTRY', 'INTERNATIONAL') NOT NULL DEFAULT 'SCHOOL',
    `countryCode` VARCHAR(2) NULL,
    `regionCode` VARCHAR(120) NULL,
    `districtCode` VARCHAR(120) NULL,
    `gradeRangeJson` LONGTEXT NULL,
    `eligibilityJson` LONGTEXT NULL,
    `scoringPolicyJson` LONGTEXT NOT NULL,
    `participantLimit` INTEGER NULL,
    `registrationOpensAt` DATETIME(3) NULL,
    `registrationClosesAt` DATETIME(3) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `publicVisibility` BOOLEAN NOT NULL DEFAULT false,
    `bannerUrl` VARCHAR(191) NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompetitionTournament_slug_key`(`slug`),
    INDEX `CompetitionTournament_status_startsAt_endsAt_idx`(`status`, `startsAt`, `endsAt`),
    INDEX `CompetitionTournament_scope_countryCode_regionCode_districtC_idx`(`scope`, `countryCode`, `regionCode`, `districtCode`),
    INDEX `CompetitionTournament_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `CompetitionTournament_categoryId_status_idx`(`categoryId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionTournamentSchool` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'WITHDRAWN', 'DISQUALIFIED') NOT NULL DEFAULT 'PENDING',
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `approvedByUserId` VARCHAR(191) NULL,
    `decisionReason` TEXT NULL,

    INDEX `CompetitionTournamentSchool_schoolId_status_idx`(`schoolId`, `status`),
    UNIQUE INDEX `CompetitionTournamentSchool_tournamentId_schoolId_key`(`tournamentId`, `schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionTournamentParticipant` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `tournamentSchoolId` VARCHAR(191) NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'WITHDRAWN', 'DISQUALIFIED') NOT NULL DEFAULT 'PENDING',
    `displayNameSnapshot` VARCHAR(160) NOT NULL,
    `visibilityApproved` BOOLEAN NOT NULL DEFAULT false,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,

    INDEX `CompetitionTournamentParticipant_schoolId_tournamentId_statu_idx`(`schoolId`, `tournamentId`, `status`),
    INDEX `CompetitionTournamentParticipant_classId_tournamentId_idx`(`classId`, `tournamentId`),
    UNIQUE INDEX `CompetitionTournamentParticipant_tournamentId_pupilId_key`(`tournamentId`, `pupilId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionTournamentRound` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `roundNumber` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'LIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `rulesJson` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionTournamentRound_tournamentId_status_idx`(`tournamentId`, `status`),
    UNIQUE INDEX `CompetitionTournamentRound_tournamentId_roundNumber_key`(`tournamentId`, `roundNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionTournamentMatch` (
    `id` VARCHAR(191) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `homeParticipantId` VARCHAR(191) NULL,
    `awayParticipantId` VARCHAR(191) NULL,
    `winnerParticipantId` VARCHAR(191) NULL,
    `status` ENUM('SCHEDULED', 'LIVE', 'COMPLETED', 'FORFEITED', 'DISPUTED') NOT NULL DEFAULT 'SCHEDULED',
    `scheduledAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `homeScore` INTEGER NULL,
    `awayScore` INTEGER NULL,
    `resultJson` LONGTEXT NULL,
    `disputeStatus` VARCHAR(40) NULL,

    INDEX `CompetitionTournamentMatch_roundId_status_idx`(`roundId`, `status`),
    INDEX `CompetitionTournamentMatch_homeParticipantId_idx`(`homeParticipantId`),
    INDEX `CompetitionTournamentMatch_awayParticipantId_idx`(`awayParticipantId`),
    INDEX `CompetitionTournamentMatch_winnerParticipantId_idx`(`winnerParticipantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionSponsor` (
    `id` VARCHAR(191) NOT NULL,
    `advertiserId` VARCHAR(191) NOT NULL,
    `sponsorshipLevel` ENUM('PRIMARY', 'SECONDARY', 'PRIZE') NOT NULL DEFAULT 'SECONDARY',
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `prizeContribution` TEXT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompetitionSponsor_advertiserId_key`(`advertiserId`),
    INDEX `CompetitionSponsor_status_startsAt_endsAt_idx`(`status`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionTournamentSponsor` (
    `id` VARCHAR(191) NOT NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NOT NULL,
    `level` ENUM('PRIMARY', 'SECONDARY', 'PRIZE') NOT NULL,
    `deliverablesJson` LONGTEXT NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionTournamentSponsor_sponsorId_level_idx`(`sponsorId`, `level`),
    UNIQUE INDEX `CompetitionTournamentSponsor_tournamentId_sponsorId_key`(`tournamentId`, `sponsorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionPrize` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NULL,
    `recipientPupilId` VARCHAR(191) NULL,
    `participantId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `valueMinor` INTEGER NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'NGN',
    `status` ENUM('AVAILABLE', 'AWARDED', 'FULFILLING', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'AVAILABLE',
    `awardedAt` DATETIME(3) NULL,
    `fulfilledAt` DATETIME(3) NULL,
    `fulfillmentNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionPrize_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `CompetitionPrize_tournamentId_status_idx`(`tournamentId`, `status`),
    INDEX `CompetitionPrize_recipientPupilId_idx`(`recipientPupilId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionCertificate` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NULL,
    `attemptId` VARCHAR(191) NULL,
    `participantId` VARCHAR(191) NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `certificateCodeHash` VARCHAR(128) NOT NULL,
    `displayNameSnapshot` VARCHAR(160) NOT NULL,
    `schoolNameSnapshot` VARCHAR(191) NOT NULL,
    `achievementTitle` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('ISSUED', 'REVOKED') NOT NULL DEFAULT 'ISSUED',
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` TEXT NULL,

    UNIQUE INDEX `CompetitionCertificate_certificateCodeHash_key`(`certificateCodeHash`),
    INDEX `CompetitionCertificate_schoolId_issuedAt_idx`(`schoolId`, `issuedAt`),
    INDEX `CompetitionCertificate_pupilId_issuedAt_idx`(`pupilId`, `issuedAt`),
    INDEX `CompetitionCertificate_tournamentId_status_idx`(`tournamentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionAnnouncement` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `tournamentId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `publishedAt` DATETIME(3) NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitionAnnouncement_schoolId_publishedAt_idx`(`schoolId`, `publishedAt`),
    INDEX `CompetitionAnnouncement_tournamentId_publishedAt_idx`(`tournamentId`, `publishedAt`),
    INDEX `CompetitionAnnouncement_isPublic_publishedAt_idx`(`isPublic`, `publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionSuspiciousActivity` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NULL,
    `attemptId` VARCHAR(191) NULL,
    `eventType` VARCHAR(80) NOT NULL,
    `status` ENUM('OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED') NOT NULL DEFAULT 'OPEN',
    `evidenceJson` LONGTEXT NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `resolution` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionSuspiciousActivity_schoolId_status_createdAt_idx`(`schoolId`, `status`, `createdAt`),
    INDEX `CompetitionSuspiciousActivity_pupilId_createdAt_idx`(`pupilId`, `createdAt`),
    INDEX `CompetitionSuspiciousActivity_attemptId_idx`(`attemptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionAuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `actorUserId` VARCHAR(191) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `beforeJson` LONGTEXT NULL,
    `afterJson` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionAuditLog_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `CompetitionAuditLog_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    INDEX `CompetitionAuditLog_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompetitionAnalyticsSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `scope` VARCHAR(40) NOT NULL,
    `scopeKey` VARCHAR(191) NOT NULL,
    `metricsJson` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CompetitionAnalyticsSnapshot_date_scope_idx`(`date`, `scope`),
    INDEX `CompetitionAnalyticsSnapshot_schoolId_date_idx`(`schoolId`, `date`),
    UNIQUE INDEX `CompetitionAnalyticsSnapshot_schoolId_date_scope_scopeKey_key`(`schoolId`, `date`, `scope`, `scopeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompetitionPupilAccount` ADD CONSTRAINT `CompetitionPupilAccount_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPupilAccount` ADD CONSTRAINT `CompetitionPupilAccount_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPupilAccount` ADD CONSTRAINT `CompetitionPupilAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPupilAccount` ADD CONSTRAINT `CompetitionPupilAccount_linkedByUserId_fkey` FOREIGN KEY (`linkedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCategory` ADD CONSTRAINT `CompetitionCategory_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCategory` ADD CONSTRAINT `CompetitionCategory_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionQuestionSet` ADD CONSTRAINT `CompetitionQuestionSet_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionQuestionSet` ADD CONSTRAINT `CompetitionQuestionSet_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `CompetitionCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionQuestionSet` ADD CONSTRAINT `CompetitionQuestionSet_subjectId_fkey` FOREIGN KEY (`subjectId`) REFERENCES `Subject`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionQuestion` ADD CONSTRAINT `CompetitionQuestion_questionSetId_fkey` FOREIGN KEY (`questionSetId`) REFERENCES `CompetitionQuestionSet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionQuestionOption` ADD CONSTRAINT `CompetitionQuestionOption_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `CompetitionQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionQuestionMedia` ADD CONSTRAINT `CompetitionQuestionMedia_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `CompetitionQuestion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `CompetitionCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_questionSetId_fkey` FOREIGN KEY (`questionSetId`) REFERENCES `CompetitionQuestionSet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_scoringPolicyId_fkey` FOREIGN KEY (`scoringPolicyId`) REFERENCES `CompetitionScoringPolicy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallenge` ADD CONSTRAINT `CompetitionChallenge_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `CompetitionChallenge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `AcademicYear`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `Term`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionChallengeAttempt` ADD CONSTRAINT `CompetitionChallengeAttempt_scoringPolicyId_fkey` FOREIGN KEY (`scoringPolicyId`) REFERENCES `CompetitionScoringPolicy`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAttemptQuestion` ADD CONSTRAINT `CompetitionAttemptQuestion_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `CompetitionChallengeAttempt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAttemptQuestion` ADD CONSTRAINT `CompetitionAttemptQuestion_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `CompetitionQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAnswerSubmission` ADD CONSTRAINT `CompetitionAnswerSubmission_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `CompetitionChallengeAttempt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAnswerSubmission` ADD CONSTRAINT `CompetitionAnswerSubmission_questionId_fkey` FOREIGN KEY (`questionId`) REFERENCES `CompetitionQuestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionStudentChallenge` ADD CONSTRAINT `CompetitionStudentChallenge_challengeId_fkey` FOREIGN KEY (`challengeId`) REFERENCES `CompetitionChallenge`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionStudentChallenge` ADD CONSTRAINT `CompetitionStudentChallenge_senderPupilId_fkey` FOREIGN KEY (`senderPupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionStudentChallenge` ADD CONSTRAINT `CompetitionStudentChallenge_recipientPupilId_fkey` FOREIGN KEY (`recipientPupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionXpTransaction` ADD CONSTRAINT `CompetitionXpTransaction_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionXpTransaction` ADD CONSTRAINT `CompetitionXpTransaction_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionXpTransaction` ADD CONSTRAINT `CompetitionXpTransaction_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `CompetitionChallengeAttempt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPupilAchievement` ADD CONSTRAINT `CompetitionPupilAchievement_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPupilAchievement` ADD CONSTRAINT `CompetitionPupilAchievement_achievementId_fkey` FOREIGN KEY (`achievementId`) REFERENCES `CompetitionAchievement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionLeaderboardSnapshot` ADD CONSTRAINT `CompetitionLeaderboardSnapshot_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournament` ADD CONSTRAINT `CompetitionTournament_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournament` ADD CONSTRAINT `CompetitionTournament_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `CompetitionCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentSchool` ADD CONSTRAINT `CompetitionTournamentSchool_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentSchool` ADD CONSTRAINT `CompetitionTournamentSchool_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentParticipant` ADD CONSTRAINT `CompetitionTournamentParticipant_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentParticipant` ADD CONSTRAINT `CompetitionTournamentParticipant_tournamentSchoolId_fkey` FOREIGN KEY (`tournamentSchoolId`) REFERENCES `CompetitionTournamentSchool`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentParticipant` ADD CONSTRAINT `CompetitionTournamentParticipant_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentParticipant` ADD CONSTRAINT `CompetitionTournamentParticipant_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentParticipant` ADD CONSTRAINT `CompetitionTournamentParticipant_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `Class`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentRound` ADD CONSTRAINT `CompetitionTournamentRound_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentMatch` ADD CONSTRAINT `CompetitionTournamentMatch_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `CompetitionTournamentRound`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentMatch` ADD CONSTRAINT `CompetitionTournamentMatch_homeParticipantId_fkey` FOREIGN KEY (`homeParticipantId`) REFERENCES `CompetitionTournamentParticipant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentMatch` ADD CONSTRAINT `CompetitionTournamentMatch_awayParticipantId_fkey` FOREIGN KEY (`awayParticipantId`) REFERENCES `CompetitionTournamentParticipant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentMatch` ADD CONSTRAINT `CompetitionTournamentMatch_winnerParticipantId_fkey` FOREIGN KEY (`winnerParticipantId`) REFERENCES `CompetitionTournamentParticipant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSponsor` ADD CONSTRAINT `CompetitionSponsor_advertiserId_fkey` FOREIGN KEY (`advertiserId`) REFERENCES `Advertiser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentSponsor` ADD CONSTRAINT `CompetitionTournamentSponsor_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionTournamentSponsor` ADD CONSTRAINT `CompetitionTournamentSponsor_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `CompetitionSponsor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPrize` ADD CONSTRAINT `CompetitionPrize_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPrize` ADD CONSTRAINT `CompetitionPrize_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPrize` ADD CONSTRAINT `CompetitionPrize_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `CompetitionSponsor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPrize` ADD CONSTRAINT `CompetitionPrize_recipientPupilId_fkey` FOREIGN KEY (`recipientPupilId`) REFERENCES `Pupil`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionPrize` ADD CONSTRAINT `CompetitionPrize_participantId_fkey` FOREIGN KEY (`participantId`) REFERENCES `CompetitionTournamentParticipant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCertificate` ADD CONSTRAINT `CompetitionCertificate_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCertificate` ADD CONSTRAINT `CompetitionCertificate_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCertificate` ADD CONSTRAINT `CompetitionCertificate_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `CompetitionChallengeAttempt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCertificate` ADD CONSTRAINT `CompetitionCertificate_participantId_fkey` FOREIGN KEY (`participantId`) REFERENCES `CompetitionTournamentParticipant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionCertificate` ADD CONSTRAINT `CompetitionCertificate_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAnnouncement` ADD CONSTRAINT `CompetitionAnnouncement_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAnnouncement` ADD CONSTRAINT `CompetitionAnnouncement_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `CompetitionTournament`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSuspiciousActivity` ADD CONSTRAINT `CompetitionSuspiciousActivity_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSuspiciousActivity` ADD CONSTRAINT `CompetitionSuspiciousActivity_pupilId_fkey` FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionSuspiciousActivity` ADD CONSTRAINT `CompetitionSuspiciousActivity_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `CompetitionChallengeAttempt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAuditLog` ADD CONSTRAINT `CompetitionAuditLog_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAuditLog` ADD CONSTRAINT `CompetitionAuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetitionAnalyticsSnapshot` ADD CONSTRAINT `CompetitionAnalyticsSnapshot_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
