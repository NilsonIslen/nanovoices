CREATE TYPE "PublicationRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'REPLACED');
CREATE TYPE "PaymentStatus" AS ENUM ('PROCESSED', 'UNASSOCIATED', 'INVALID_AMOUNT', 'INVALID_DESTINATION', 'UNCONFIRMED', 'DUPLICATE');
CREATE TYPE "OperationType" AS ENUM ('INITIAL_PUBLICATION', 'UPDATE');

CREATE TABLE "VerifiedAccount" (
  "id" TEXT NOT NULL,
  "nanoAddress" TEXT NOT NULL,
  "currentMessage" TEXT NOT NULL,
  "showBalance" BOOLEAN NOT NULL DEFAULT true,
  "cachedBalanceRaw" TEXT NOT NULL DEFAULT '0',
  "balanceUpdatedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "hiddenByModeration" BOOLEAN NOT NULL DEFAULT false,
  "moderationReason" TEXT,
  "moderationUpdatedAt" TIMESTAMP(3),
  CONSTRAINT "VerifiedAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationRequest" (
  "id" TEXT NOT NULL,
  "nanoAddress" TEXT NOT NULL,
  "pendingMessage" TEXT NOT NULL,
  "showBalance" BOOLEAN NOT NULL DEFAULT true,
  "status" "PublicationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "paymentHash" TEXT,
  CONSTRAINT "PublicationRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "blockHash" TEXT NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "destinationAddress" TEXT NOT NULL,
  "amountRaw" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "requestId" TEXT,
  "status" "PaymentStatus" NOT NULL DEFAULT 'UNASSOCIATED',
  "operationType" "OperationType",
  "notes" TEXT,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageHistory" (
  "id" TEXT NOT NULL,
  "verifiedAccountId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "showBalance" BOOLEAN NOT NULL,
  "paymentHash" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedAt" TIMESTAMP(3),
  "hiddenByModeration" BOOLEAN NOT NULL DEFAULT false,
  "moderationReason" TEXT,
  CONSTRAINT "MessageHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAudit" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerifiedAccount_nanoAddress_key" ON "VerifiedAccount"("nanoAddress");
CREATE INDEX "VerifiedAccount_hiddenByModeration_nanoAddress_idx" ON "VerifiedAccount"("hiddenByModeration", "nanoAddress");
CREATE INDEX "VerifiedAccount_verifiedAt_idx" ON "VerifiedAccount"("verifiedAt");
CREATE INDEX "PublicationRequest_nanoAddress_status_expiresAt_idx" ON "PublicationRequest"("nanoAddress", "status", "expiresAt");
CREATE INDEX "PublicationRequest_createdAt_idx" ON "PublicationRequest"("createdAt");
CREATE UNIQUE INDEX "Payment_blockHash_key" ON "Payment"("blockHash");
CREATE INDEX "Payment_sourceAddress_status_idx" ON "Payment"("sourceAddress", "status");
CREATE INDEX "Payment_destinationAddress_detectedAt_idx" ON "Payment"("destinationAddress", "detectedAt");
CREATE INDEX "MessageHistory_verifiedAccountId_publishedAt_idx" ON "MessageHistory"("verifiedAccountId", "publishedAt");
CREATE INDEX "MessageHistory_paymentHash_idx" ON "MessageHistory"("paymentHash");
CREATE INDEX "AdminAudit_action_createdAt_idx" ON "AdminAudit"("action", "createdAt");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PublicationRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageHistory" ADD CONSTRAINT "MessageHistory_verifiedAccountId_fkey" FOREIGN KEY ("verifiedAccountId") REFERENCES "VerifiedAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
