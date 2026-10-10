-- CreateEnum
CREATE TYPE "training_chat_role" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "training_chat_message" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "week_start_date_key" TEXT NOT NULL,
    "role" "training_chat_role" NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" JSONB,
    "applied_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_chat_message_owner_sub_week_start_date_key_created_idx" ON "training_chat_message"("owner_sub", "week_start_date_key", "created_at");

