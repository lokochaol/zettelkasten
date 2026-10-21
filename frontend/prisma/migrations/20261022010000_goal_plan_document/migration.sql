-- CreateTable
CREATE TABLE "goal_plan_document" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "applied" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_plan_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_plan_document_owner_sub_created_at_idx" ON "goal_plan_document"("owner_sub", "created_at");

