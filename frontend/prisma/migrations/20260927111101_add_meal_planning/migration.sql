-- CreateEnum
CREATE TYPE "MealSlot" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateTable
CREATE TABLE "meal_preference" (
    "owner_sub" TEXT NOT NULL,
    "weekly_budget_yen" INTEGER NOT NULL DEFAULT 8000,
    "weekday_cook_minutes" INTEGER NOT NULL DEFAULT 20,
    "shopping_weekday" INTEGER NOT NULL DEFAULT 1,
    "dislikes" TEXT NOT NULL DEFAULT '',
    "allergies" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_preference_pkey" PRIMARY KEY ("owner_sub")
);

-- CreateTable
CREATE TABLE "meal_plan" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "week_start_date_key" TEXT NOT NULL,
    "target_kcal" INTEGER NOT NULL,
    "target_protein_g" INTEGER NOT NULL,
    "target_fiber_g" INTEGER NOT NULL,
    "budget_yen" INTEGER NOT NULL,
    "prompt_summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_meal" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "date_key" TEXT NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "title" TEXT NOT NULL,
    "recipe" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL,
    "protein_g" DOUBLE PRECISION NOT NULL,
    "fat_g" DOUBLE PRECISION NOT NULL,
    "carb_g" DOUBLE PRECISION NOT NULL,
    "fiber_g" DOUBLE PRECISION NOT NULL,
    "salt_g" DOUBLE PRECISION NOT NULL,
    "prep_minutes" INTEGER NOT NULL,
    "google_event_id" TEXT,

    CONSTRAINT "planned_meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_item" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "estimated_yen" INTEGER NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "shopping_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_plan_owner_sub_week_start_date_key_idx" ON "meal_plan"("owner_sub", "week_start_date_key");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_owner_sub_week_start_date_key_key" ON "meal_plan"("owner_sub", "week_start_date_key");

-- CreateIndex
CREATE INDEX "planned_meal_plan_id_date_key_idx" ON "planned_meal"("plan_id", "date_key");

-- CreateIndex
CREATE UNIQUE INDEX "planned_meal_plan_id_date_key_slot_key" ON "planned_meal"("plan_id", "date_key", "slot");

-- CreateIndex
CREATE INDEX "shopping_item_plan_id_idx" ON "shopping_item"("plan_id");

-- AddForeignKey
ALTER TABLE "planned_meal" ADD CONSTRAINT "planned_meal_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "meal_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "meal_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
