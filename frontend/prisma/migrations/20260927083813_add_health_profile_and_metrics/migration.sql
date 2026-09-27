-- CreateEnum
CREATE TYPE "BiologicalSex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE');

-- CreateTable
CREATE TABLE "health_profile" (
    "owner_sub" TEXT NOT NULL,
    "height_cm" DOUBLE PRECISION NOT NULL,
    "birth_year" INTEGER NOT NULL,
    "sex" "BiologicalSex" NOT NULL,
    "activity_level" "ActivityLevel" NOT NULL DEFAULT 'LIGHT',
    "weekly_kg_delta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_profile_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateTable
CREATE TABLE "health_daily_metric" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "weight_kg" DOUBLE PRECISION,
    "active_energy_kcal" DOUBLE PRECISION,
    "steps" INTEGER,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_daily_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_ingest_token" (
    "owner_sub" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_ingest_token_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateIndex
CREATE INDEX "health_daily_metric_owner_sub_date_key_idx" ON "health_daily_metric"("owner_sub", "date_key");

-- CreateIndex
CREATE UNIQUE INDEX "health_daily_metric_owner_sub_date_key_key" ON "health_daily_metric"("owner_sub", "date_key");

-- CreateIndex
CREATE UNIQUE INDEX "health_ingest_token_token_prefix_key" ON "health_ingest_token"("token_prefix");
