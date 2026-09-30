CREATE TABLE `SchoolActivity` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `SchoolActivity_schoolId_isActive_idx`(`schoolId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScheduledActivity` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `configId` VARCHAR(191) NOT NULL,
    `periodId` VARCHAR(191) NOT NULL,
    `activityId` VARCHAR(191) NOT NULL,
    `audienceType` ENUM('SCHOOL', 'CLASSES') NOT NULL DEFAULT 'SCHOOL',
    `location` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ScheduledActivity_schoolId_configId_idx`(`schoolId`, `configId`),
    INDEX `ScheduledActivity_periodId_idx`(`periodId`),
    INDEX `ScheduledActivity_activityId_idx`(`activityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScheduledActivityClass` (
    `scheduledActivityId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    INDEX `ScheduledActivityClass_classId_idx`(`classId`),
    PRIMARY KEY (`scheduledActivityId`, `classId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SchoolActivity`
    ADD CONSTRAINT `SchoolActivity_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ScheduledActivity`
    ADD CONSTRAINT `ScheduledActivity_schoolId_fkey`
    FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `ScheduledActivity_configId_fkey`
    FOREIGN KEY (`configId`) REFERENCES `TimetableConfig`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `ScheduledActivity_periodId_fkey`
    FOREIGN KEY (`periodId`) REFERENCES `TimetablePeriod`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `ScheduledActivity_activityId_fkey`
    FOREIGN KEY (`activityId`) REFERENCES `SchoolActivity`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ScheduledActivityClass`
    ADD CONSTRAINT `ScheduledActivityClass_scheduledActivityId_fkey`
    FOREIGN KEY (`scheduledActivityId`) REFERENCES `ScheduledActivity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `ScheduledActivityClass_classId_fkey`
    FOREIGN KEY (`classId`) REFERENCES `Class`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;