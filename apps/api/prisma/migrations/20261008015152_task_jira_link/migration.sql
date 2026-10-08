-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "jiraIssueKey" TEXT,
ADD COLUMN     "jiraStatus" TEXT,
ADD COLUMN     "jiraSyncError" TEXT,
ADD COLUMN     "jiraUrl" TEXT;

-- CreateIndex
CREATE INDEX "Task_workspaceId_jiraIssueKey_idx" ON "Task"("workspaceId", "jiraIssueKey");
