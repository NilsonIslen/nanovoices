ALTER TYPE "OperationType" ADD VALUE 'REPLY';

ALTER TABLE "PublicationRequest"
  ADD COLUMN "replyToAccountId" TEXT;

CREATE TABLE "Reply" (
  "id" TEXT NOT NULL,
  "parentAccountId" TEXT NOT NULL,
  "nanoAddress" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "showBalance" BOOLEAN NOT NULL DEFAULT true,
  "cachedBalanceRaw" TEXT NOT NULL DEFAULT '0',
  "balanceUpdatedAt" TIMESTAMP(3),
  "paymentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "hiddenByModeration" BOOLEAN NOT NULL DEFAULT false,
  "moderationReason" TEXT,
  CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reply_parentAccountId_nanoAddress_key" ON "Reply"("parentAccountId", "nanoAddress");
CREATE INDEX "Reply_nanoAddress_idx" ON "Reply"("nanoAddress");
CREATE INDEX "Reply_parentAccountId_hiddenByModeration_idx" ON "Reply"("parentAccountId", "hiddenByModeration");
CREATE INDEX "PublicationRequest_replyToAccountId_status_expiresAt_idx" ON "PublicationRequest"("replyToAccountId", "status", "expiresAt");

ALTER TABLE "PublicationRequest"
  ADD CONSTRAINT "PublicationRequest_replyToAccountId_fkey"
  FOREIGN KEY ("replyToAccountId") REFERENCES "VerifiedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reply"
  ADD CONSTRAINT "Reply_parentAccountId_fkey"
  FOREIGN KEY ("parentAccountId") REFERENCES "VerifiedAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
