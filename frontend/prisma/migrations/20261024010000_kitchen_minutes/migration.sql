-- AlterTable
ALTER TABLE "meal_plan" ADD COLUMN     "kitchen_minutes" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "meal_preference" ADD COLUMN     "kitchen_minutes" JSONB NOT NULL DEFAULT '[]';

