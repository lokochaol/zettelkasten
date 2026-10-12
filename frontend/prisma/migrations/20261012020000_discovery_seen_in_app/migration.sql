-- AlterTable
ALTER TABLE "discovery_candidate" ADD COLUMN     "seen_at" TIMESTAMP(3);

-- DropTable
DROP TABLE "push_subscription";

-- What was already there when this shipped has been seen: only finds from
-- here on count as new.
UPDATE "discovery_candidate" SET "seen_at" = CURRENT_TIMESTAMP WHERE "seen_at" IS NULL;
