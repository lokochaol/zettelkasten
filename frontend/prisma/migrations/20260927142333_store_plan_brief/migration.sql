-- AlterTable
ALTER TABLE "meal_plan" ADD COLUMN     "cook_sessions_per_week" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "ready_made_meals_per_week" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "target_salt_max_g" DOUBLE PRECISION NOT NULL DEFAULT 7.5,
ADD COLUMN     "weekday_cook_minutes" INTEGER NOT NULL DEFAULT 20;
