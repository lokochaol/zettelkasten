-- CreateEnum
CREATE TYPE "StorageLocation" AS ENUM ('FRIDGE', 'FREEZER', 'PANTRY');

-- CreateEnum
CREATE TYPE "MealChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "inventory_item" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT NOT NULL DEFAULT '',
    "location" "StorageLocation" NOT NULL DEFAULT 'FRIDGE',
    "shopping_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_chat_message" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "role" "MealChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "proposal" JSONB,
    "applied_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_shopping_item_id_key" ON "inventory_item"("shopping_item_id");

-- CreateIndex
CREATE INDEX "inventory_item_owner_sub_idx" ON "inventory_item"("owner_sub");

-- CreateIndex
CREATE INDEX "meal_chat_message_plan_id_created_at_idx" ON "meal_chat_message"("plan_id", "created_at");

-- AddForeignKey
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_shopping_item_id_fkey" FOREIGN KEY ("shopping_item_id") REFERENCES "shopping_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_chat_message" ADD CONSTRAINT "meal_chat_message_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "meal_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
