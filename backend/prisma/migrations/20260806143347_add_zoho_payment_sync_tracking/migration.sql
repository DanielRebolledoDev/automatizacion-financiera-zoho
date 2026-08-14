/*
  Warnings:

  - A unique constraint covering the columns `[zohoCustomerPaymentId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `payments` ADD COLUMN `zohoCustomerPaymentId` VARCHAR(100) NULL,
    ADD COLUMN `zohoSyncError` TEXT NULL,
    ADD COLUMN `zohoSyncStatus` ENUM('NOT_SYNCED', 'DRY_RUN_READY', 'SYNCED', 'FAILED') NOT NULL DEFAULT 'NOT_SYNCED',
    ADD COLUMN `zohoSyncedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `payments_zohoCustomerPaymentId_key` ON `payments`(`zohoCustomerPaymentId`);

-- CreateIndex
CREATE INDEX `payments_zohoSyncStatus_idx` ON `payments`(`zohoSyncStatus`);
