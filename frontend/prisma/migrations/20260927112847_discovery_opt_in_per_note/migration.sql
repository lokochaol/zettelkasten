-- AlterTable
ALTER TABLE "discovery_schedule" ALTER COLUMN "times_per_day" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "quick_note" ADD COLUMN     "discovery_enabled" BOOLEAN NOT NULL DEFAULT false;
