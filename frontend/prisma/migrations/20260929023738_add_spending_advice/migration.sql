-- CreateTable
CREATE TABLE "spending_advice" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "week_start_date_key" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actions_json" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spending_advice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spending_advice_owner_sub_idx" ON "spending_advice"("owner_sub");

-- CreateIndex
CREATE UNIQUE INDEX "spending_advice_owner_sub_week_start_date_key_key" ON "spending_advice"("owner_sub", "week_start_date_key");
