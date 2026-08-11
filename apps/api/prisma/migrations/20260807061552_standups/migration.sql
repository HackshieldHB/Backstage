-- CreateTable
CREATE TABLE "Standup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "days" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunOn" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Standup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandupMember" (
    "id" TEXT NOT NULL,
    "standupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "StandupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandupResponse" (
    "id" TEXT NOT NULL,
    "standupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "onDate" TEXT NOT NULL,
    "yesterday" TEXT NOT NULL DEFAULT '',
    "today" TEXT NOT NULL DEFAULT '',
    "blockers" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandupResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Standup_workspaceId_idx" ON "Standup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StandupMember_standupId_userId_key" ON "StandupMember"("standupId", "userId");

-- CreateIndex
CREATE INDEX "StandupResponse_standupId_onDate_idx" ON "StandupResponse"("standupId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "StandupResponse_standupId_userId_onDate_key" ON "StandupResponse"("standupId", "userId", "onDate");

-- AddForeignKey
ALTER TABLE "Standup" ADD CONSTRAINT "Standup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Standup" ADD CONSTRAINT "Standup_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Standup" ADD CONSTRAINT "Standup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupMember" ADD CONSTRAINT "StandupMember_standupId_fkey" FOREIGN KEY ("standupId") REFERENCES "Standup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupMember" ADD CONSTRAINT "StandupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupResponse" ADD CONSTRAINT "StandupResponse_standupId_fkey" FOREIGN KEY ("standupId") REFERENCES "Standup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandupResponse" ADD CONSTRAINT "StandupResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
