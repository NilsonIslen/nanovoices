ALTER TABLE "PublicationRequest"
  ALTER COLUMN "nanoAddress" SET DEFAULT '',
  ALTER COLUMN "pendingMessage" SET DEFAULT '',
  ADD COLUMN "replyToReplyId" TEXT;

ALTER TABLE "Reply"
  ADD COLUMN "parentReplyId" TEXT,
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 2;

DROP INDEX IF EXISTS "Reply_parentAccountId_nanoAddress_key";

CREATE UNIQUE INDEX "Reply_parentReplyId_nanoAddress_key" ON "Reply"("parentReplyId", "nanoAddress");
CREATE INDEX "Reply_parentReplyId_hiddenByModeration_idx" ON "Reply"("parentReplyId", "hiddenByModeration");
CREATE INDEX "Reply_level_idx" ON "Reply"("level");
CREATE INDEX "PublicationRequest_replyToReplyId_status_expiresAt_idx" ON "PublicationRequest"("replyToReplyId", "status", "expiresAt");

ALTER TABLE "PublicationRequest"
  ADD CONSTRAINT "PublicationRequest_replyToReplyId_fkey"
  FOREIGN KEY ("replyToReplyId") REFERENCES "Reply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Reply"
  ADD CONSTRAINT "Reply_parentReplyId_fkey"
  FOREIGN KEY ("parentReplyId") REFERENCES "Reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
