-- AlterTable
ALTER TABLE "planned_meal" ADD COLUMN     "recipe_detail" JSONB,
ADD COLUMN     "recipe_url" TEXT NOT NULL DEFAULT '';

