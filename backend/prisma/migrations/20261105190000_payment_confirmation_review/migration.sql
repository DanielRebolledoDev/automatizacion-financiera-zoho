ALTER TABLE `payments` ADD COLUMN `confirmationReviewRequired` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `confirmationReviewReason` VARCHAR(100) NULL;
