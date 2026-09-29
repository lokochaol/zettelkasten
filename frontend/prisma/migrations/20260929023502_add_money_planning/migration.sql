-- CreateEnum
CREATE TYPE "commitment_kind" AS ENUM ('INSTALMENT', 'SUBSCRIPTION', 'FIXED');

-- CreateTable
CREATE TABLE "money_profile" (
    "owner_sub" TEXT NOT NULL,
    "monthly_income_yen" INTEGER NOT NULL DEFAULT 0,
    "minimum_living_yen" INTEGER NOT NULL DEFAULT 40000,
    "buffer_yen" INTEGER NOT NULL DEFAULT 20000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_profile_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateTable
CREATE TABLE "commitment" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "commitment_kind" NOT NULL,
    "monthly_yen" INTEGER NOT NULL,
    "from_month" TEXT NOT NULL,
    "to_month" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goal" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_yen" INTEGER NOT NULL,
    "target_month" TEXT NOT NULL,
    "saved_yen" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "month_budget" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount_yen" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commitment_owner_sub_idx" ON "commitment"("owner_sub");

-- CreateIndex
CREATE INDEX "savings_goal_owner_sub_idx" ON "savings_goal"("owner_sub");

-- CreateIndex
CREATE INDEX "month_budget_owner_sub_month_idx" ON "month_budget"("owner_sub", "month");

-- CreateIndex
CREATE UNIQUE INDEX "month_budget_owner_sub_month_category_key" ON "month_budget"("owner_sub", "month", "category");
