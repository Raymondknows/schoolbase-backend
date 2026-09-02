CREATE TABLE `SupportInternalNote` (
  `id` VARCHAR(191) NOT NULL,
  `supportRequestId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NULL,
  `body` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `SupportInternalNote_supportRequestId_idx` (`supportRequestId`),
  INDEX `SupportInternalNote_authorId_idx` (`authorId`),
  CONSTRAINT `SupportInternalNote_supportRequestId_fkey` FOREIGN KEY (`supportRequestId`) REFERENCES `SupportRequest` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SupportInternalNote_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupportTeamTask` (
  `id` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` LONGTEXT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
  `priority` VARCHAR(191) NOT NULL DEFAULT 'MEDIUM',
  `assignedTo` VARCHAR(191) NULL,
  `createdBy` VARCHAR(191) NULL,
  `dueAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `SupportTeamTask_status_idx` (`status`),
  INDEX `SupportTeamTask_assignedTo_idx` (`assignedTo`),
  INDEX `SupportTeamTask_createdBy_idx` (`createdBy`),
  INDEX `SupportTeamTask_dueAt_idx` (`dueAt`),
  CONSTRAINT `SupportTeamTask_assignedTo_fkey` FOREIGN KEY (`assignedTo`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `SupportTeamTask_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SupportAttachment` (
  `id` VARCHAR(191) NOT NULL,
  `supportRequestId` VARCHAR(191) NOT NULL,
  `supportMessageId` VARCHAR(191) NULL,
  `fileName` VARCHAR(191) NOT NULL,
  `originalName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `size` INTEGER NOT NULL,
  `url` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `SupportAttachment_supportRequestId_idx` (`supportRequestId`),
  INDEX `SupportAttachment_supportMessageId_idx` (`supportMessageId`),
  CONSTRAINT `SupportAttachment_supportRequestId_fkey` FOREIGN KEY (`supportRequestId`) REFERENCES `SupportRequest` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SupportAttachment_supportMessageId_fkey` FOREIGN KEY (`supportMessageId`) REFERENCES `SupportRequestMessage` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;