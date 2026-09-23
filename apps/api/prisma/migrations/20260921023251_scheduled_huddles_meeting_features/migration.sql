-- CreateTable
CREATE TABLE "ScheduledHuddle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "conversationId" TEXT,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledHuddle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledHuddle_scheduledFor_idx" ON "ScheduledHuddle"("scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledHuddle_workspaceId_idx" ON "ScheduledHuddle"("workspaceId");

-- CreateIndex
CREATE INDEX "ScheduledHuddle_channelId_idx" ON "ScheduledHuddle"("channelId");

-- CreateIndex
CREATE INDEX "ScheduledHuddle_conversationId_idx" ON "ScheduledHuddle"("conversationId");

-- AddForeignKey
ALTER TABLE "ScheduledHuddle" ADD CONSTRAINT "ScheduledHuddle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledHuddle" ADD CONSTRAINT "ScheduledHuddle_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledHuddle" ADD CONSTRAINT "ScheduledHuddle_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledHuddle" ADD CONSTRAINT "ScheduledHuddle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
