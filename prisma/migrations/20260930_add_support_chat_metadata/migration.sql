ALTER TABLE `SupportRequest`
    ADD COLUMN `createdByUserId` VARCHAR(191) NULL,
    ADD COLUMN `createdByGuardianId` VARCHAR(191) NULL,
    ADD COLUMN `requesterName` VARCHAR(191) NULL,
    ADD COLUMN `requesterEmail` VARCHAR(191) NULL,
    ADD COLUMN `requesterRole` VARCHAR(191) NULL,
    ADD COLUMN `lastMessageAt` DATETIME(3) NULL;

UPDATE `SupportRequest`
SET `lastMessageAt` = `updatedAt`
WHERE `lastMessageAt` IS NULL;

ALTER TABLE `SupportRequest`
    MODIFY COLUMN `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY COLUMN `status` ENUM('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    ADD INDEX `SupportRequest_schoolId_lastMessageAt_idx` (`schoolId`, `lastMessageAt`),
    ADD INDEX `SupportRequest_status_lastMessageAt_idx` (`status`, `lastMessageAt`),
    ADD INDEX `SupportRequest_createdByUserId_idx` (`createdByUserId`),
    ADD INDEX `SupportRequest_createdByGuardianId_idx` (`createdByGuardianId`),
    ADD CONSTRAINT `SupportRequest_createdByUserId_fkey`
      FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `SupportRequest_createdByGuardianId_fkey`
      FOREIGN KEY (`createdByGuardianId`) REFERENCES `Guardian`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SupportRequestMessage`
    ADD COLUMN `senderUserId` VARCHAR(191) NULL,
    ADD COLUMN `senderGuardianId` VARCHAR(191) NULL,
    ADD COLUMN `readAt` DATETIME(3) NULL,
    ADD INDEX `SupportRequestMessage_senderUserId_idx` (`senderUserId`),
    ADD INDEX `SupportRequestMessage_senderGuardianId_idx` (`senderGuardianId`),
    ADD INDEX `SupportRequestMessage_requestId_senderRole_readAt_idx` (`supportRequestId`, `senderRole`, `readAt`),
    ADD CONSTRAINT `SupportRequestMessage_senderUserId_fkey`
      FOREIGN KEY (`senderUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `SupportRequestMessage_senderGuardianId_fkey`
      FOREIGN KEY (`senderGuardianId`) REFERENCES `Guardian`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;