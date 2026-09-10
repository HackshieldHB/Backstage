-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('PERSON', 'CHANNEL', 'PRIORITY', 'FOCUS', 'EXPERT', 'CATCHUP', 'KNOWLEDGE', 'FOLLOWUP');

-- CreateEnum
CREATE TYPE "RecommendationAction" AS ENUM ('DISMISSED', 'ACTED');

-- CreateTable
CREATE TABLE "RecommendationFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RecommendationKind" NOT NULL,
    "refId" TEXT NOT NULL,
    "action" "RecommendationAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationFeedback_workspaceId_userId_kind_idx" ON "RecommendationFeedback"("workspaceId", "userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationFeedback_userId_kind_refId_key" ON "RecommendationFeedback"("userId", "kind", "refId");

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
