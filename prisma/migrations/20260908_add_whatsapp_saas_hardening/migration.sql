-- Durable WhatsApp delivery records and per-school safety policies
CREATE TABLE `WhatsAppDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `guardianId` VARCHAR(191),
    `event` VARCHAR(191) NOT NULL,
    `recipientAddress` VARCHAR(191) NOT NULL,
    `recipientName` VARCHAR(191),
    `messageHash` VARCHAR(191) NOT NULL,
    `messagePreview` VARCHAR(500),
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `provider` VARCHAR(191),
    `providerMessageId` VARCHAR(191),
    `attemptCount` INT NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3),
    `lastError` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppDelivery_schoolId_status_nextAttemptAt_idx`(`schoolId`, `status`, `nextAttemptAt`),
    INDEX `WhatsAppDelivery_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `WhatsAppDelivery_schoolId_messageHash_idx`(`schoolId`, `messageHash`),
    INDEX `WhatsAppDelivery_guardianId_idx`(`guardianId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WhatsAppPolicy` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `messagesPerMinute` INT NOT NULL DEFAULT 10,
    `messagesPerHour` INT NOT NULL DEFAULT 100,
    `messagesPerDay` INT NOT NULL DEFAULT 300,
    `batchSize` INT NOT NULL DEFAULT 25,
    `batchCooldownSeconds` INT NOT NULL DEFAULT 120,
    `quietHoursStart` VARCHAR(191) NOT NULL DEFAULT '21:00',
    `quietHoursEnd` VARCHAR(191) NOT NULL DEFAULT '07:00',
    `requireApprovalForBulk` BOOLEAN NOT NULL DEFAULT true,
    `allowAutomaticRetries` BOOLEAN NOT NULL DEFAULT true,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Africa/Lagos',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppPolicy_schoolId_key`(`schoolId`),
    INDEX `WhatsAppPolicy_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CommunicationRule` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `channels` VARCHAR(255) NOT NULL,
    `template` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CommunicationRule_schoolId_event_key`(`schoolId`, `event`),
    INDEX `CommunicationRule_schoolId_enabled_idx`(`schoolId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsAppDelivery` ADD CONSTRAINT `WhatsAppDelivery_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WhatsAppDelivery` ADD CONSTRAINT `WhatsAppDelivery_guardianId_fkey` FOREIGN KEY (`guardianId`) REFERENCES `Guardian`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WhatsAppPolicy` ADD CONSTRAINT `WhatsAppPolicy_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CommunicationRule` ADD CONSTRAINT `CommunicationRule_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
