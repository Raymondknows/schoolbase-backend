CREATE TABLE `IdCardPricingRule` (
    `id` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
    `ruleJson` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reason` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `IdCardPricingRule_version_key`(`version`),
    INDEX `IdCardPricingRule_isActive_effectiveAt_idx`(`isActive`, `effectiveAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IdCardQuote` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pricingRuleId` VARCHAR(191) NOT NULL,
    `pricingRuleVersion` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUOTED',
    `currency` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateTier` VARCHAR(191) NOT NULL,
    `subtotalMinor` INTEGER NOT NULL,
    `discountMinor` INTEGER NOT NULL DEFAULT 0,
    `taxMinor` INTEGER NOT NULL DEFAULT 0,
    `totalMinor` INTEGER NOT NULL,
    `studentIdsJson` LONGTEXT NOT NULL,
    `optionsJson` LONGTEXT NOT NULL,
    `renderSnapshotEncrypted` LONGTEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `IdCardQuote_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `IdCardQuote_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IdCardOrder` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PAYMENT_PENDING',
    `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `currency` VARCHAR(191) NOT NULL,
    `amountMinor` INTEGER NOT NULL,
    `providerReference` VARCHAR(191),
    `providerTransactionId` VARCHAR(191),
    `renderSnapshotEncrypted` LONGTEXT,
    `artifactKey` VARCHAR(512),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `IdCardOrder_quoteId_key`(`quoteId`),
    UNIQUE INDEX `IdCardOrder_providerReference_key`(`providerReference`),
    UNIQUE INDEX `IdCardOrder_providerTransactionId_key`(`providerTransactionId`),
    INDEX `IdCardOrder_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `IdCardOrder_status_paymentStatus_idx`(`status`, `paymentStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IdCardOrderEvent` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191),
    `details` LONGTEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `IdCardOrderEvent_orderId_createdAt_idx`(`orderId`, `createdAt`),
    INDEX `IdCardOrderEvent_eventType_createdAt_idx`(`eventType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IdCardUsageAward` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `awardType` VARCHAR(191) NOT NULL,
    `unitsGranted` INTEGER NOT NULL DEFAULT 0,
    `unitsReserved` INTEGER NOT NULL DEFAULT 0,
    `unitsRedeemed` INTEGER NOT NULL DEFAULT 0,
    `valueMinor` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
    `eligibleTiersJson` LONGTEXT NOT NULL,
    `reasonCategory` VARCHAR(191) NOT NULL,
    `campaign` VARCHAR(191),
    `internalNote` TEXT,
    `terms` TEXT,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_APPROVAL',
    `expiresAt` DATETIME(3),
    `createdBy` VARCHAR(191) NOT NULL,
    `approvedBy` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `IdCardUsageAward_schoolId_status_expiresAt_idx`(`schoolId`, `status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IdCardAwardLedger` (
    `id` VARCHAR(191) NOT NULL,
    `awardId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191),
    `entryType` VARCHAR(191) NOT NULL,
    `units` INTEGER NOT NULL DEFAULT 0,
    `amountMinor` INTEGER NOT NULL DEFAULT 0,
    `actorId` VARCHAR(191),
    `reason` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `IdCardAwardLedger_awardId_createdAt_idx`(`awardId`, `createdAt`),
    INDEX `IdCardAwardLedger_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IdCardQuote`
    ADD CONSTRAINT `IdCardQuote_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IdCardOrder`
    ADD CONSTRAINT `IdCardOrder_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `IdCardOrder_quoteId_fkey`
    FOREIGN KEY (`quoteId`) REFERENCES `IdCardQuote`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `IdCardOrderEvent`
    ADD CONSTRAINT `IdCardOrderEvent_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `IdCardOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IdCardUsageAward`
    ADD CONSTRAINT `IdCardUsageAward_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `IdCardAwardLedger`
    ADD CONSTRAINT `IdCardAwardLedger_awardId_fkey`
    FOREIGN KEY (`awardId`) REFERENCES `IdCardUsageAward`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `IdCardAwardLedger_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `IdCardOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
