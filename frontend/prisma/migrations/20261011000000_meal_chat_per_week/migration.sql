-- Chat moves from the plan to the owner's week, so it can start before a
-- plan exists. Existing messages keep their plan's owner and week.
ALTER TABLE "meal_chat_message" ADD COLUMN "owner_sub" TEXT,
ADD COLUMN "week_start_date_key" TEXT;

UPDATE "meal_chat_message" AS m
SET "owner_sub" = p."owner_sub", "week_start_date_key" = p."week_start_date_key"
FROM "meal_plan" AS p
WHERE p."id" = m."plan_id";

ALTER TABLE "meal_chat_message" ALTER COLUMN "owner_sub" SET NOT NULL,
ALTER COLUMN "week_start_date_key" SET NOT NULL;

-- DropForeignKey
ALTER TABLE "meal_chat_message" DROP CONSTRAINT "meal_chat_message_plan_id_fkey";

-- DropIndex
DROP INDEX "meal_chat_message_plan_id_created_at_idx";

-- AlterTable
ALTER TABLE "meal_chat_message" DROP COLUMN "plan_id";

-- CreateIndex
CREATE INDEX "meal_chat_message_owner_sub_week_start_date_key_created_at_idx" ON "meal_chat_message"("owner_sub", "week_start_date_key", "created_at");
