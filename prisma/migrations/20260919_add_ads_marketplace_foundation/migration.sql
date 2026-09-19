-- Create the platform Ads & Marketplace foundation.
CREATE TABLE `Advertiser` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191),
    `website` VARCHAR(191),
    `category` VARCHAR(191),
    `verificationStatus` ENUM('PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
    `verifiedAt` DATETIME(3),
    `rejectionReason` TEXT,
    `notes` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `Advertiser_verificationStatus_idx`(`verificationStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdPlacement` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('LOGIN_PAGE_BANNER','PUBLIC_PARTNER_STRIP','RESOURCE_SPONSOR') NOT NULL,
    `path` VARCHAR(191),
    `label` VARCHAR(191) NOT NULL DEFAULT 'Sponsored',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AdPlacement_type_key`(`type`),
    INDEX `AdPlacement_enabled_sortOrder_idx`(`enabled`,`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `advertiserId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `headline` VARCHAR(191),
    `summary` TEXT,
    `landingUrl` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','LIVE','PAUSED','EXPIRED') NOT NULL DEFAULT 'DRAFT',
    `startDate` DATETIME(3),
    `endDate` DATETIME(3),
    `budget` DOUBLE NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'NGN',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `approvedBy` VARCHAR(191),
    `approvedAt` DATETIME(3),
    `rejectedReason` TEXT,
    `submittedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `AdCampaign_slug_key`(`slug`),
    INDEX `AdCampaign_advertiserId_idx`(`advertiserId`),
    INDEX `AdCampaign_status_idx`(`status`),
    INDEX `AdCampaign_startDate_endDate_idx`(`startDate`,`endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdCampaignPlacement` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `placementId` VARCHAR(191) NOT NULL,
    `sortOrder` INT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AdCampaignPlacement_campaignId_placementId_key`(`campaignId`,`placementId`),
    INDEX `AdCampaignPlacement_placementId_idx`(`placementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdCreative` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191),
    `headline` VARCHAR(191),
    `description` TEXT,
    `ctaText` VARCHAR(191) DEFAULT 'Learn more',
    `altText` VARCHAR(191),
    `assetType` VARCHAR(191) NOT NULL DEFAULT 'IMAGE',
    `isPrimary` BOOLEAN NOT NULL DEFAULT true,
    `approvedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `AdCreative_campaignId_idx`(`campaignId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CampaignApprovalLog` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `reviewerId` VARCHAR(191),
    `action` VARCHAR(191) NOT NULL,
    `reason` TEXT,
    `notes` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `CampaignApprovalLog_campaignId_createdAt_idx`(`campaignId`,`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AdAnalyticsEvent` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `placementId` VARCHAR(191),
    `eventType` ENUM('IMPRESSION','CLICK') NOT NULL,
    `sourcePath` VARCHAR(191),
    `userAgent` VARCHAR(191),
    `referrer` VARCHAR(191),
    `ipHash` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AdAnalyticsEvent_campaignId_eventType_idx`(`campaignId`,`eventType`),
    INDEX `AdAnalyticsEvent_sourcePath_idx`(`sourcePath`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AdCampaign`
    ADD CONSTRAINT `AdCampaign_advertiserId_fkey`
    FOREIGN KEY (`advertiserId`) REFERENCES `Advertiser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AdCampaignPlacement`
    ADD CONSTRAINT `AdCampaignPlacement_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `AdCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `AdCampaignPlacement_placementId_fkey`
    FOREIGN KEY (`placementId`) REFERENCES `AdPlacement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AdCreative`
    ADD CONSTRAINT `AdCreative_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `AdCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CampaignApprovalLog`
    ADD CONSTRAINT `CampaignApprovalLog_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `AdCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AdAnalyticsEvent`
    ADD CONSTRAINT `AdAnalyticsEvent_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `AdCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
