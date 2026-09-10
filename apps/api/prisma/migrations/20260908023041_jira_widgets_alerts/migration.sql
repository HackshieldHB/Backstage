-- CreateTable
CREATE TABLE "JiraSavedWidget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "jql" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JiraSavedWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraAlertRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "staleDays" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "timeOfDay" TEXT NOT NULL DEFAULT '09:00',
    "lastRunOn" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JiraSavedWidget_workspaceId_idx" ON "JiraSavedWidget"("workspaceId");

-- CreateIndex
CREATE INDEX "JiraAlertRule_workspaceId_idx" ON "JiraAlertRule"("workspaceId");

-- AddForeignKey
ALTER TABLE "JiraSavedWidget" ADD CONSTRAINT "JiraSavedWidget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraSavedWidget" ADD CONSTRAINT "JiraSavedWidget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAlertRule" ADD CONSTRAINT "JiraAlertRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAlertRule" ADD CONSTRAINT "JiraAlertRule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAlertRule" ADD CONSTRAINT "JiraAlertRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
