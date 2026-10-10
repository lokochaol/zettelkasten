-- CreateEnum
CREATE TYPE "training_experience" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "training_kind" AS ENUM ('STRENGTH', 'CARDIO', 'MOBILITY');

-- CreateEnum
CREATE TYPE "training_status" AS ENUM ('PLANNED', 'DONE', 'SKIPPED');

-- AlterTable
ALTER TABLE "health_profile" ADD COLUMN     "target_lean_mass_kg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "training_preference" (
    "owner_sub" TEXT NOT NULL,
    "days_per_week" INTEGER NOT NULL DEFAULT 3,
    "minutes_per_session" INTEGER NOT NULL DEFAULT 45,
    "equipment" TEXT NOT NULL DEFAULT '',
    "limitations" TEXT NOT NULL DEFAULT '',
    "focus" TEXT NOT NULL DEFAULT '',
    "experience" "training_experience" NOT NULL DEFAULT 'BEGINNER',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_preference_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateTable
CREATE TABLE "training_plan" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "week_start_date_key" TEXT NOT NULL,
    "analysis" TEXT NOT NULL DEFAULT '',
    "focus" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_session" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "training_kind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "exercises" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "training_status" NOT NULL DEFAULT 'PLANNED',
    "rpe" INTEGER,
    "log" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "training_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_plan_owner_sub_week_start_date_key_key" ON "training_plan"("owner_sub", "week_start_date_key");

-- CreateIndex
CREATE INDEX "training_session_plan_id_date_key_idx" ON "training_session"("plan_id", "date_key");

-- AddForeignKey
ALTER TABLE "training_session" ADD CONSTRAINT "training_session_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "training_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

