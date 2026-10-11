-- CreateEnum
CREATE TYPE "goal_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "goal_compass" (
    "owner_sub" TEXT NOT NULL,
    "principles" TEXT NOT NULL DEFAULT '',
    "happiness" TEXT NOT NULL DEFAULT '',
    "essentials" TEXT NOT NULL DEFAULT '',
    "obstacles" TEXT NOT NULL DEFAULT '',
    "archive" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_compass_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL DEFAULT '',
    "reviewed_on_date_key" TEXT,
    "status" "goal_status" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_milestone" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "due_date_key" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "done_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_revision" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_focus_period" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "from_date_key" TEXT,
    "to_date_key" TEXT,
    "weekday" JSONB NOT NULL DEFAULT '[]',
    "holiday" JSONB NOT NULL DEFAULT '[]',
    "spare" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_focus_period_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_owner_sub_status_sort_order_idx" ON "goal"("owner_sub", "status", "sort_order");

-- CreateIndex
CREATE INDEX "goal_milestone_goal_id_sort_order_idx" ON "goal_milestone"("goal_id", "sort_order");

-- CreateIndex
CREATE INDEX "goal_revision_goal_id_created_at_idx" ON "goal_revision"("goal_id", "created_at");

-- CreateIndex
CREATE INDEX "goal_focus_period_owner_sub_sort_order_idx" ON "goal_focus_period"("owner_sub", "sort_order");

-- AddForeignKey
ALTER TABLE "goal_milestone" ADD CONSTRAINT "goal_milestone_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_revision" ADD CONSTRAINT "goal_revision_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

