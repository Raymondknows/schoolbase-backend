-- Track how each recorded payment is allocated across invoice lines.
CREATE TABLE `PaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `invoiceItemId` VARCHAR(191) NOT NULL,
    `amount` INT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentAllocation_paymentId_invoiceItemId_key`(`paymentId`, `invoiceItemId`),
    INDEX `PaymentAllocation_paymentId_idx`(`paymentId`),
    INDEX `PaymentAllocation_invoiceItemId_idx`(`invoiceItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PaymentAllocation`
    ADD CONSTRAINT `PaymentAllocation_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `PaymentAllocation_invoiceItemId_fkey`
    FOREIGN KEY (`invoiceItemId`) REFERENCES `InvoiceItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
