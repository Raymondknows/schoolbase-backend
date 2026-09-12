-- Add school-configurable fee lines, invoice breakdowns, and student adjustments.
CREATE TABLE `FeeScheduleItem` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `feeScheduleId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` INT NOT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `description` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeeScheduleItem_feeScheduleId_idx`(`feeScheduleId`),
    INDEX `FeeScheduleItem_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InvoiceItem` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `feeScheduleItemId` VARCHAR(191),
    `name` VARCHAR(191) NOT NULL,
    `amount` INT NOT NULL,
    `quantity` INT NOT NULL DEFAULT 1,
    `description` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InvoiceItem_invoiceId_idx`(`invoiceId`),
    INDEX `InvoiceItem_feeScheduleItemId_idx`(`feeScheduleItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StudentFeeAdjustment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191),
    `feeScheduleItemId` VARCHAR(191),
    `adjustmentType` ENUM('SCHOLARSHIP', 'DISCOUNT', 'WAIVER', 'BURSARY', 'EXEMPTION') NOT NULL,
    `amount` INT,
    `percentage` DOUBLE,
    `reason` VARCHAR(191),
    `status` ENUM('ACTIVE', 'APPROVED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `approvedBy` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StudentFeeAdjustment_schoolId_studentId_idx`(`schoolId`, `studentId`),
    INDEX `StudentFeeAdjustment_invoiceId_idx`(`invoiceId`),
    INDEX `StudentFeeAdjustment_feeScheduleItemId_idx`(`feeScheduleItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FeeScheduleItem`
    ADD CONSTRAINT `FeeScheduleItem_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `FeeScheduleItem_feeScheduleId_fkey`
    FOREIGN KEY (`feeScheduleId`) REFERENCES `FeeSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `InvoiceItem`
    ADD CONSTRAINT `InvoiceItem_invoiceId_fkey`
    FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `InvoiceItem_feeScheduleItemId_fkey`
    FOREIGN KEY (`feeScheduleItemId`) REFERENCES `FeeScheduleItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `StudentFeeAdjustment`
    ADD CONSTRAINT `StudentFeeAdjustment_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `StudentFeeAdjustment_studentId_fkey`
    FOREIGN KEY (`studentId`) REFERENCES `Pupil`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `StudentFeeAdjustment_invoiceId_fkey`
    FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `StudentFeeAdjustment_feeScheduleItemId_fkey`
    FOREIGN KEY (`feeScheduleItemId`) REFERENCES `FeeScheduleItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
