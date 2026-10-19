-- CreateEnum
CREATE TYPE "MeetingRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY');

-- CreateEnum
CREATE TYPE "MeetingResponse" AS ENUM ('ACCEPTED', 'TENTATIVE', 'DECLINED');

-- AlterTable
ALTER TABLE "ScheduledHuddle" ADD COLUMN     "description" TEXT,
ADD COLUMN     "recurrence" "MeetingRecurrence" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "reminderMins" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- CreateTable
CREATE TABLE "ScheduledHuddleResponse" (
    "id" TEXT NOT NULL,
    "scheduledHuddleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "response" "MeetingResponse" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledHuddleResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledHuddleResponse_userId_idx" ON "ScheduledHuddleResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledHuddleResponse_scheduledHuddleId_userId_key" ON "ScheduledHuddleResponse"("scheduledHuddleId", "userId");

-- CreateIndex
CREATE INDEX "ScheduledHuddle_seriesId_idx" ON "ScheduledHuddle"("seriesId");

-- AddForeignKey
ALTER TABLE "ScheduledHuddleResponse" ADD CONSTRAINT "ScheduledHuddleResponse_scheduledHuddleId_fkey" FOREIGN KEY ("scheduledHuddleId") REFERENCES "ScheduledHuddle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledHuddleResponse" ADD CONSTRAINT "ScheduledHuddleResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

