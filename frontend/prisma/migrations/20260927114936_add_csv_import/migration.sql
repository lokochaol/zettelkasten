-- CreateTable
CREATE TABLE "csv_import_profile" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date_column" TEXT NOT NULL,
    "amount_column" TEXT NOT NULL,
    "memo_column" TEXT NOT NULL,
    "amount_is_negative_for_spending" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "csv_import_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_rule" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "csv_import_profile_owner_sub_name_key" ON "csv_import_profile"("owner_sub", "name");

-- CreateIndex
CREATE INDEX "category_rule_owner_sub_idx" ON "category_rule"("owner_sub");

-- CreateIndex
CREATE UNIQUE INDEX "category_rule_owner_sub_keyword_key" ON "category_rule"("owner_sub", "keyword");
