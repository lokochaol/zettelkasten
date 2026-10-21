-- AlterTable
ALTER TABLE "goal" ADD COLUMN     "approach" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "budget_note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "color" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "commute_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "improve_check" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "keep_record" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "weekly_hours" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "goal_milestone" ADD COLUMN     "condition" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "start_date_key" TEXT;

-- CreateTable
CREATE TABLE "goal_plan" (
    "owner_sub" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "vision" TEXT NOT NULL DEFAULT '',
    "baseline" TEXT NOT NULL DEFAULT '',
    "life_budget" JSONB NOT NULL DEFAULT '[]',
    "decision_rules" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_plan_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateTable
CREATE TABLE "goal_cycle" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "from_date_key" TEXT NOT NULL,
    "to_date_key" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "phases" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_cycle_outcome" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "area" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "hours_note" TEXT NOT NULL DEFAULT '',
    "phase_texts" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "goal_cycle_outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_week_slot" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "goal_id" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "commute" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "goal_week_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_event" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "goal_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'EVENT',
    "title" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "end_date_key" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_check" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "goal_id" TEXT,
    "question" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "impact" TEXT NOT NULL DEFAULT '',
    "due_date_key" TEXT,
    "answer" TEXT NOT NULL DEFAULT '',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_task" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "goal_id" TEXT,
    "text" TEXT NOT NULL,
    "due_date_key" TEXT,
    "done_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_daily_log" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "special" BOOLEAN NOT NULL DEFAULT false,
    "hours" JSONB NOT NULL DEFAULT '{}',
    "commute_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progress" TEXT NOT NULL DEFAULT '',
    "blocker" TEXT NOT NULL DEFAULT '',
    "next" TEXT NOT NULL DEFAULT '',
    "life" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_daily_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_review" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "special" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_deliverable" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "goal_id" TEXT,
    "week_start_date_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "evidence" TEXT NOT NULL DEFAULT '',
    "check_date_key" TEXT,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_experiment" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "goal_id" TEXT,
    "observation" TEXT NOT NULL DEFAULT '',
    "hypothesis" TEXT NOT NULL DEFAULT '',
    "change" TEXT NOT NULL DEFAULT '',
    "evidence" TEXT NOT NULL DEFAULT '',
    "review_date_key" TEXT,
    "keep_if" TEXT NOT NULL DEFAULT '',
    "otherwise" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "outcome" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_change_log" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "before" TEXT NOT NULL DEFAULT '',
    "after" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "check_date_key" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_advisor_message" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" JSONB,
    "applied_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_advisor_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_cycle_owner_sub_from_date_key_idx" ON "goal_cycle"("owner_sub", "from_date_key");

-- CreateIndex
CREATE INDEX "goal_cycle_outcome_cycle_id_sort_order_idx" ON "goal_cycle_outcome"("cycle_id", "sort_order");

-- CreateIndex
CREATE INDEX "goal_week_slot_owner_sub_weekday_idx" ON "goal_week_slot"("owner_sub", "weekday");

-- CreateIndex
CREATE INDEX "goal_event_owner_sub_date_key_idx" ON "goal_event"("owner_sub", "date_key");

-- CreateIndex
CREATE INDEX "goal_check_owner_sub_created_at_idx" ON "goal_check"("owner_sub", "created_at");

-- CreateIndex
CREATE INDEX "goal_task_owner_sub_sort_order_idx" ON "goal_task"("owner_sub", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "goal_daily_log_owner_sub_date_key_key" ON "goal_daily_log"("owner_sub", "date_key");

-- CreateIndex
CREATE UNIQUE INDEX "goal_review_owner_sub_kind_date_key_key" ON "goal_review"("owner_sub", "kind", "date_key");

-- CreateIndex
CREATE INDEX "goal_deliverable_owner_sub_week_start_date_key_idx" ON "goal_deliverable"("owner_sub", "week_start_date_key");

-- CreateIndex
CREATE INDEX "goal_experiment_owner_sub_created_at_idx" ON "goal_experiment"("owner_sub", "created_at");

-- CreateIndex
CREATE INDEX "goal_change_log_owner_sub_created_at_idx" ON "goal_change_log"("owner_sub", "created_at");

-- CreateIndex
CREATE INDEX "goal_advisor_message_owner_sub_created_at_idx" ON "goal_advisor_message"("owner_sub", "created_at");

-- AddForeignKey
ALTER TABLE "goal_cycle_outcome" ADD CONSTRAINT "goal_cycle_outcome_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "goal_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_cycle_outcome" ADD CONSTRAINT "goal_cycle_outcome_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_week_slot" ADD CONSTRAINT "goal_week_slot_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_event" ADD CONSTRAINT "goal_event_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_check" ADD CONSTRAINT "goal_check_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_task" ADD CONSTRAINT "goal_task_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_deliverable" ADD CONSTRAINT "goal_deliverable_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_experiment" ADD CONSTRAINT "goal_experiment_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

