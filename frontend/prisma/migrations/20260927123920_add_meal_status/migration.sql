-- CreateEnum
CREATE TYPE "meal_status" AS ENUM ('PLANNED', 'EATEN', 'SKIPPED', 'REPLACED');

-- AlterTable
ALTER TABLE "planned_meal" ADD COLUMN     "replacement_note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" "meal_status" NOT NULL DEFAULT 'PLANNED';
