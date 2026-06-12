-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('TOTAL_DEBT', 'OVERDUE_DEBT', 'MANUAL_SELECTION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'IN_PROGRESS', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('KHIPU', 'ZOHO', 'SYSTEM');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "rut" VARCHAR(20) NOT NULL,
    "rut_normalized" VARCHAR(20) NOT NULL,
    "business_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "zoho_customer_id" VARCHAR(100),
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "zoho_document_id" VARCHAR(100),
    "document_type" "DocumentType" NOT NULL DEFAULT 'INVOICE',
    "document_number" VARCHAR(100) NOT NULL,
    "issue_date" DATE,
    "due_date" DATE NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "outstanding_amount" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CLP',
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CLP',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "khipu_payment_id" VARCHAR(100),
    "khipu_payment_url" TEXT,
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_documents" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "customer_id" UUID,
    "mode" "PaymentMode" NOT NULL,
    "amount" INTEGER,
    "status" "PaymentStatus" NOT NULL,
    "error_message" TEXT,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "event_source" "EventSource" NOT NULL DEFAULT 'KHIPU',
    "event_type" VARCHAR(100),
    "external_event_id" VARCHAR(150),
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_rut_key" ON "customers"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "customers_rut_normalized_key" ON "customers"("rut_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "customers_zoho_customer_id_key" ON "customers"("zoho_customer_id");

-- CreateIndex
CREATE INDEX "customer_documents_customer_id_idx" ON "customer_documents"("customer_id");

-- CreateIndex
CREATE INDEX "customer_documents_status_idx" ON "customer_documents"("status");

-- CreateIndex
CREATE INDEX "customer_documents_due_date_idx" ON "customer_documents"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "customer_documents_customer_id_document_number_key" ON "customer_documents"("customer_id", "document_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_khipu_payment_id_key" ON "payments"("khipu_payment_id");

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_mode_idx" ON "payments"("mode");

-- CreateIndex
CREATE INDEX "payment_documents_payment_id_idx" ON "payment_documents"("payment_id");

-- CreateIndex
CREATE INDEX "payment_documents_document_id_idx" ON "payment_documents"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_documents_payment_id_document_id_key" ON "payment_documents"("payment_id", "document_id");

-- CreateIndex
CREATE INDEX "payment_attempts_payment_id_idx" ON "payment_attempts"("payment_id");

-- CreateIndex
CREATE INDEX "payment_attempts_customer_id_idx" ON "payment_attempts"("customer_id");

-- CreateIndex
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_external_event_id_key" ON "payment_events"("external_event_id");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events"("payment_id");

-- CreateIndex
CREATE INDEX "payment_events_event_source_idx" ON "payment_events"("event_source");

-- CreateIndex
CREATE INDEX "payment_events_processed_idx" ON "payment_events"("processed");

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_documents" ADD CONSTRAINT "payment_documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_documents" ADD CONSTRAINT "payment_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "customer_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
