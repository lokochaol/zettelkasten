-- AlterTable
ALTER TABLE "goal_plan_document" ADD COLUMN     "sub_plan_id" TEXT;

-- CreateTable
CREATE TABLE "goal_sub_plan" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "goal_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "unit_label" TEXT NOT NULL DEFAULT '',
    "target_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "week_columns" JSONB NOT NULL DEFAULT '[]',
    "weeks" JSONB NOT NULL DEFAULT '[]',
    "days" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_sub_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_item" (
    "id" TEXT NOT NULL,
    "sub_plan_id" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "size" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "record" TEXT NOT NULL DEFAULT '',
    "period_label" TEXT NOT NULL DEFAULT '',
    "from_date_key" TEXT,
    "to_date_key" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "goal_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_item_step" (
    "id" TEXT NOT NULL,
    "sub_plan_id" TEXT NOT NULL,
    "item_id" TEXT,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "start_date_key" TEXT,
    "date_key" TEXT NOT NULL,
    "backup_date_key" TEXT,
    "done_at" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "goal_item_step_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_sub_plan_owner_sub_sort_order_idx" ON "goal_sub_plan"("owner_sub", "sort_order");

-- CreateIndex
CREATE INDEX "goal_item_sub_plan_id_sort_order_idx" ON "goal_item"("sub_plan_id", "sort_order");

-- CreateIndex
CREATE INDEX "goal_item_step_sub_plan_id_date_key_idx" ON "goal_item_step"("sub_plan_id", "date_key");

-- CreateIndex
CREATE INDEX "goal_plan_document_sub_plan_id_created_at_idx" ON "goal_plan_document"("sub_plan_id", "created_at");

-- AddForeignKey
ALTER TABLE "goal_sub_plan" ADD CONSTRAINT "goal_sub_plan_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_item" ADD CONSTRAINT "goal_item_sub_plan_id_fkey" FOREIGN KEY ("sub_plan_id") REFERENCES "goal_sub_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_item_step" ADD CONSTRAINT "goal_item_step_sub_plan_id_fkey" FOREIGN KEY ("sub_plan_id") REFERENCES "goal_sub_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_item_step" ADD CONSTRAINT "goal_item_step_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "goal_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

