-- AlterTable
ALTER TABLE "goal_plan" ADD COLUMN     "routine" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "time_block" ADD COLUMN     "source" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "goal_day_plan" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "pushed" JSONB NOT NULL DEFAULT '[]',
    "pushed_to" TEXT NOT NULL DEFAULT '',
    "pushed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_day_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_day_plan_message" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" JSONB,
    "applied_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_day_plan_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goal_day_plan_owner_sub_date_key_key" ON "goal_day_plan"("owner_sub", "date_key");

-- CreateIndex
CREATE INDEX "goal_day_plan_message_owner_sub_date_key_created_at_idx" ON "goal_day_plan_message"("owner_sub", "date_key", "created_at");

