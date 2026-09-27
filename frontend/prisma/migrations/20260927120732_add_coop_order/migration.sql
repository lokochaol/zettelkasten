-- AlterTable
ALTER TABLE "meal_preference" ADD COLUMN     "coop_delivery_weekday" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "coop_order_lead_days" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "coop_order" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "week_start_date_key" TEXT NOT NULL,
    "order_by_date_key" TEXT NOT NULL,
    "delivery_date_key" TEXT NOT NULL,
    "refined" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coop_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coop_order_item" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "estimated_yen" INTEGER NOT NULL,
    "local_instead" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL DEFAULT '',
    "chosen" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "coop_order_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coop_order_owner_sub_order_by_date_key_idx" ON "coop_order"("owner_sub", "order_by_date_key");

-- CreateIndex
CREATE UNIQUE INDEX "coop_order_owner_sub_week_start_date_key_key" ON "coop_order"("owner_sub", "week_start_date_key");

-- CreateIndex
CREATE INDEX "coop_order_item_order_id_idx" ON "coop_order_item"("order_id");

-- AddForeignKey
ALTER TABLE "coop_order_item" ADD CONSTRAINT "coop_order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "coop_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
