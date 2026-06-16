-- CreateTable
CREATE TABLE `health_checks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` CHAR(36) NOT NULL,
    `rut` VARCHAR(20) NOT NULL,
    `rut_normalized` VARCHAR(20) NOT NULL,
    `business_name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `zoho_customer_id` VARCHAR(100) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_rut_key`(`rut`),
    UNIQUE INDEX `customers_rut_normalized_key`(`rut_normalized`),
    UNIQUE INDEX `customers_zoho_customer_id_key`(`zoho_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_documents` (
    `id` CHAR(36) NOT NULL,
    `customer_id` CHAR(36) NOT NULL,
    `zoho_document_id` VARCHAR(100) NULL,
    `document_type` ENUM('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OTHER') NOT NULL DEFAULT 'INVOICE',
    `document_number` VARCHAR(100) NOT NULL,
    `issue_date` DATE NULL,
    `due_date` DATE NOT NULL,
    `total_amount` INTEGER NOT NULL,
    `outstanding_amount` INTEGER NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'CLP',
    `status` ENUM('PENDING', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_documents_customer_id_idx`(`customer_id`),
    INDEX `customer_documents_status_idx`(`status`),
    INDEX `customer_documents_due_date_idx`(`due_date`),
    UNIQUE INDEX `customer_documents_customer_id_document_number_key`(`customer_id`, `document_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` CHAR(36) NOT NULL,
    `customer_id` CHAR(36) NOT NULL,
    `mode` ENUM('TOTAL_DEBT', 'OVERDUE_DEBT', 'MANUAL_SELECTION') NOT NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'CLP',
    `status` ENUM('CREATED', 'PENDING', 'IN_PROGRESS', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'CREATED',
    `idempotency_key` VARCHAR(200) NOT NULL,
    `khipu_payment_id` VARCHAR(100) NULL,
    `khipu_payment_url` TEXT NULL,
    `expires_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_idempotency_key_key`(`idempotency_key`),
    UNIQUE INDEX `payments_khipu_payment_id_key`(`khipu_payment_id`),
    INDEX `payments_customer_id_idx`(`customer_id`),
    INDEX `payments_status_idx`(`status`),
    INDEX `payments_mode_idx`(`mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_documents` (
    `id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,
    `amount` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_documents_payment_id_idx`(`payment_id`),
    INDEX `payment_documents_document_id_idx`(`document_id`),
    UNIQUE INDEX `payment_documents_payment_id_document_id_key`(`payment_id`, `document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_attempts` (
    `id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NULL,
    `customer_id` CHAR(36) NULL,
    `mode` ENUM('TOTAL_DEBT', 'OVERDUE_DEBT', 'MANUAL_SELECTION') NOT NULL,
    `amount` INTEGER NULL,
    `status` ENUM('CREATED', 'PENDING', 'IN_PROGRESS', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED') NOT NULL,
    `error_message` TEXT NULL,
    `request_payload` JSON NULL,
    `response_payload` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payment_attempts_payment_id_idx`(`payment_id`),
    INDEX `payment_attempts_customer_id_idx`(`customer_id`),
    INDEX `payment_attempts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_events` (
    `id` CHAR(36) NOT NULL,
    `payment_id` CHAR(36) NULL,
    `event_source` ENUM('KHIPU', 'ZOHO', 'SYSTEM') NOT NULL DEFAULT 'KHIPU',
    `event_type` VARCHAR(100) NULL,
    `external_event_id` VARCHAR(150) NULL,
    `payload` JSON NOT NULL,
    `processed` BOOLEAN NOT NULL DEFAULT false,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_events_external_event_id_key`(`external_event_id`),
    INDEX `payment_events_payment_id_idx`(`payment_id`),
    INDEX `payment_events_event_source_idx`(`event_source`),
    INDEX `payment_events_processed_idx`(`processed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_documents` ADD CONSTRAINT `customer_documents_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_documents` ADD CONSTRAINT `payment_documents_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_documents` ADD CONSTRAINT `payment_documents_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `customer_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
