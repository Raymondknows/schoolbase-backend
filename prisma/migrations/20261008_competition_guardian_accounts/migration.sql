ALTER TABLE `CompetitionPupilAccount`
  MODIFY `userId` VARCHAR(191) NULL,
  ADD COLUMN `guardianId` VARCHAR(191) NULL,
  ADD INDEX `CompetitionPupilAccount_guardianId_idx`(`guardianId`),
  ADD CONSTRAINT `CompetitionPupilAccount_guardianId_fkey`
    FOREIGN KEY (`guardianId`) REFERENCES `Guardian`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
