-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "signingSecret" TEXT;

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggerUserId" TEXT,
    "vars" JSONB NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "nextStep" INTEGER NOT NULL DEFAULT 0,
    "pendingUserId" TEXT,
    "pendingSince" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "messageId" TEXT,
    "channelId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_startedAt_idx" ON "WorkflowRun"("workflowId", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_pendingUserId_status_idx" ON "WorkflowRun"("pendingUserId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_expiresAt_idx" ON "WorkflowRun"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_triggerUserId_fkey" FOREIGN KEY ("triggerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_pendingUserId_fkey" FOREIGN KEY ("pendingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
