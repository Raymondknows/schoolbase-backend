-- Backfill itemized invoice snapshots for invoices issued before fee itemization.
-- Only invoices without existing lines are populated, so current itemized invoices are untouched.
INSERT INTO `InvoiceItem` (`id`, `invoiceId`, `feeScheduleItemId`, `name`, `amount`, `quantity`, `description`, `createdAt`)
SELECT
    CONCAT('legacy-invoice-item-', i.`id`, '-', fsi.`id`),
    i.`id`,
    fsi.`id`,
    fsi.`name`,
    fsi.`amount`,
    1,
    fsi.`description`,
    i.`createdAt`
FROM `Invoice` i
INNER JOIN `FeeScheduleItem` fsi
    ON fsi.`feeScheduleId` = i.`feeScheduleId`
   AND fsi.`schoolId` = i.`schoolId`
WHERE NOT EXISTS (
    SELECT 1
    FROM `InvoiceItem` existing
    WHERE existing.`invoiceId` = i.`id`
);
