-- CreateTable
CREATE TABLE "time_block" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_block_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_block_owner_sub_date_key_idx" ON "time_block"("owner_sub", "date_key");
