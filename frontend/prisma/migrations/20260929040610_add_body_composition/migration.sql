-- AlterTable
ALTER TABLE "health_daily_metric" ADD COLUMN     "body_fat_percent" DOUBLE PRECISION,
ADD COLUMN     "lean_body_mass_kg" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "health_profile" ADD COLUMN     "target_body_fat_percent" DOUBLE PRECISION;
