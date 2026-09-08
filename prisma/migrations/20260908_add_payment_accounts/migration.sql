CREATE TABLE `PaymentAccount` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `accountName` VARCHAR(191) NOT NULL,
    `accountNumber` VARCHAR(191) NOT NULL,
    `branchName` VARCHAR(191),
    `currency` VARCHAR(191),
    `purpose` VARCHAR(191),
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `PaymentAccount_schoolId_isActive_sortOrder_idx`(`schoolId`, `isActive`, `sortOrder`),
    INDEX `PaymentAccount_schoolId_isDefault_idx`(`schoolId`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PaymentAccount` ADD CONSTRAINT `PaymentAccount_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `PaymentAccount` (`id`, `schoolId`, `label`, `bankName`, `accountName`, `accountNumber`, `currency`, `isDefault`, `isActive`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT CONCAT('legacy-', `id`), `id`, 'General Fees', COALESCE(`manualPaymentBankName`, ''), COALESCE(`manualPaymentAccountName`, ''), COALESCE(`manualPaymentAccountNumber`, ''), `currency`, true, true, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `School`
WHERE COALESCE(`manualPaymentBankName`, '') <> '' OR COALESCE(`manualPaymentAccountName`, '') <> '' OR COALESCE(`manualPaymentAccountNumber`, '') <> '';
