CREATE TABLE `IdCardIssuance` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `pupilId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'GENERATED',
    `issuedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `supersedesId` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `IdCardIssuance_orderId_pupilId_key`(`orderId`, `pupilId`),
    INDEX `IdCardIssuance_schoolId_pupilId_status_idx`(`schoolId`, `pupilId`, `status`),
    INDEX `IdCardIssuance_orderId_status_idx`(`orderId`, `status`),
    INDEX `IdCardIssuance_supersedesId_idx`(`supersedesId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IdCardIssuance`
    ADD CONSTRAINT `IdCardIssuance_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `IdCardIssuance_pupilId_fkey`
    FOREIGN KEY (`pupilId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `IdCardIssuance_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `IdCardOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `IdCardIssuance_supersedesId_fkey`
    FOREIGN KEY (`supersedesId`) REFERENCES `IdCardIssuance`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
