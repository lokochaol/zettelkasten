-- CreateEnum
CREATE TYPE "meal_kind" AS ENUM ('COOK', 'BATCH', 'READY');

-- AlterTable
ALTER TABLE "meal_preference" ADD COLUMN     "cook_sessions_per_week" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "ready_made_meals_per_week" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "planned_meal" ADD COLUMN     "kind" "meal_kind" NOT NULL DEFAULT 'COOK';
