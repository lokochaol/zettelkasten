-- AlterTable
ALTER TABLE "shopping_item" ADD COLUMN     "list_id" TEXT,
ALTER COLUMN "plan_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "purchase_list" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "from_date_key" TEXT NOT NULL,
    "to_date_key" TEXT NOT NULL,
    "meals_digest" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_list_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_list_owner_sub_key" ON "purchase_list"("owner_sub");

-- CreateIndex
CREATE INDEX "shopping_item_list_id_idx" ON "shopping_item"("list_id");

-- AddForeignKey
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "purchase_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

