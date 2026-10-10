-- DropForeignKey
ALTER TABLE "coop_order_item" DROP CONSTRAINT "coop_order_item_order_id_fkey";

-- AlterTable
ALTER TABLE "meal_preference" DROP COLUMN "coop_delivery_weekday",
DROP COLUMN "coop_order_lead_days";

-- DropTable
DROP TABLE "coop_order";

-- DropTable
DROP TABLE "coop_order_item";

