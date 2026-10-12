-- CreateTable
CREATE TABLE "discovery_topic" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_topic_finding" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "kind" "DiscoveryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source_label" TEXT NOT NULL,
    "url" TEXT,
    "confidence" INTEGER NOT NULL,
    "seen_at" TIMESTAMP(3),
    "literature_memo_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_topic_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" TEXT NOT NULL,
    "owner_sub" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_topic_owner_sub_created_at_idx" ON "discovery_topic"("owner_sub", "created_at");

-- CreateIndex
CREATE INDEX "discovery_topic_finding_topic_id_created_at_idx" ON "discovery_topic_finding"("topic_id", "created_at");

-- CreateIndex
CREATE INDEX "discovery_topic_finding_owner_sub_seen_at_idx" ON "discovery_topic_finding"("owner_sub", "seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_owner_sub_idx" ON "push_subscription"("owner_sub");

-- AddForeignKey
ALTER TABLE "discovery_topic_finding" ADD CONSTRAINT "discovery_topic_finding_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "discovery_topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_topic_finding" ADD CONSTRAINT "discovery_topic_finding_literature_memo_id_fkey" FOREIGN KEY ("literature_memo_id") REFERENCES "literature_memo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

