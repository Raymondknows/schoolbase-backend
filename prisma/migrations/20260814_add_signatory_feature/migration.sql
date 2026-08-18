-- Add Signatory table and usedSignatoryId to ResultAudit

ALTER TABLE `ResultAudit`
  ADD COLUMN `usedSignatoryId` VARCHAR(191) NULL;

CREATE TABLE `Signatory` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `comment` LONGTEXT,
  `title` VARCHAR(191),
  `signatureUrl` VARCHAR(191),
  `key` VARCHAR(191),
  `active` BOOLEAN NOT NULL DEFAULT true,
  `phase` VARCHAR(191),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `Signatory_schoolId_idx`(`schoolId`),
  INDEX `Signatory_phase_idx`(`phase`),
  UNIQUE INDEX `Signatory_schoolId_key_unique`(`schoolId`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Signatory`
  ADD CONSTRAINT `Signatory_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ResultAudit`
  ADD CONSTRAINT `ResultAudit_usedSignatoryId_fkey` FOREIGN KEY (`usedSignatoryId`) REFERENCES `Signatory` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
