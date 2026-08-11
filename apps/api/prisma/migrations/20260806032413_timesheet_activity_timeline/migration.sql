-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('MEETING', 'IMPLEMENTATION', 'DOCUMENTATION', 'COLLABORATION', 'WORK_LOGGED', 'ONLINE', 'AWAY');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('JIRA_WORKLOG', 'JIRA_STATUS', 'CONFLUENCE', 'HUDDLE', 'MESSAGE', 'PRESENCE');

-- CreateTable
CREATE TABLE "ActivitySegment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "source" "ActivitySource" NOT NULL,
    "refId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "meta" JSONB,

    CONSTRAINT "ActivitySegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuddleSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "HuddleSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuddleParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "HuddleParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "comment" TEXT,
    "jiraWorklogId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilizationDaily" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "meetingSec" INTEGER NOT NULL DEFAULT 0,
    "implementationSec" INTEGER NOT NULL DEFAULT 0,
    "documentationSec" INTEGER NOT NULL DEFAULT 0,
    "collaborationSec" INTEGER NOT NULL DEFAULT 0,
    "idleSec" INTEGER NOT NULL DEFAULT 0,
    "awaySec" INTEGER NOT NULL DEFAULT 0,
    "onlineSec" INTEGER NOT NULL DEFAULT 0,
    "loggedSec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UtilizationDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivitySegment_workspaceId_userId_startedAt_idx" ON "ActivitySegment"("workspaceId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "ActivitySegment_workspaceId_startedAt_idx" ON "ActivitySegment"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "ActivitySegment_userId_source_kind_endedAt_idx" ON "ActivitySegment"("userId", "source", "kind", "endedAt");

-- CreateIndex
CREATE INDEX "HuddleSession_workspaceId_roomKey_endedAt_idx" ON "HuddleSession"("workspaceId", "roomKey", "endedAt");

-- CreateIndex
CREATE INDEX "HuddleParticipant_sessionId_idx" ON "HuddleParticipant"("sessionId");

-- CreateIndex
CREATE INDEX "HuddleParticipant_userId_idx" ON "HuddleParticipant"("userId");

-- CreateIndex
CREATE INDEX "TimesheetEntry_workspaceId_userId_startedAt_idx" ON "TimesheetEntry"("workspaceId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "UtilizationDaily_workspaceId_day_idx" ON "UtilizationDaily"("workspaceId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "UtilizationDaily_workspaceId_userId_day_key" ON "UtilizationDaily"("workspaceId", "userId", "day");

-- AddForeignKey
ALTER TABLE "ActivitySegment" ADD CONSTRAINT "ActivitySegment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySegment" ADD CONSTRAINT "ActivitySegment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuddleSession" ADD CONSTRAINT "HuddleSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuddleParticipant" ADD CONSTRAINT "HuddleParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "HuddleSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuddleParticipant" ADD CONSTRAINT "HuddleParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilizationDaily" ADD CONSTRAINT "UtilizationDaily_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilizationDaily" ADD CONSTRAINT "UtilizationDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
