-- AlterTable
ALTER TABLE "meal_preference" ADD COLUMN     "breakfast_minutes" INTEGER NOT NULL DEFAULT 420,
ADD COLUMN     "dinner_minutes" INTEGER NOT NULL DEFAULT 1140,
ADD COLUMN     "lunch_minutes" INTEGER NOT NULL DEFAULT 750,
ADD COLUMN     "sync_meals_to_calendar" BOOLEAN NOT NULL DEFAULT false;
