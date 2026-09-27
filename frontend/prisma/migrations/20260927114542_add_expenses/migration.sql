-- CreateEnum
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'CSV');

-- CreateTable
CREATE TABLE "expense" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "amount_yen" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "memo" TEXT NOT NULL DEFAULT '',
    "source" "ExpenseSource" NOT NULL DEFAULT 'MANUAL',
    "external_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_budget" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "monthly_yen" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_owner_sub_date_key_idx" ON "expense"("owner_sub", "date_key");

-- CreateIndex
CREATE UNIQUE INDEX "expense_owner_sub_external_key_key" ON "expense"("owner_sub", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "category_budget_owner_sub_category_key" ON "category_budget"("owner_sub", "category");
