-- CreateTable
CREATE TABLE "GoogleCalendarLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "pushMeetings" BOOLEAN NOT NULL DEFAULT true,
    "brokenAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleCalendarEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduledHuddleId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarLink_userId_key" ON "GoogleCalendarLink"("userId");

-- CreateIndex
CREATE INDEX "GoogleCalendarEvent_scheduledHuddleId_idx" ON "GoogleCalendarEvent"("scheduledHuddleId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarEvent_userId_scheduledHuddleId_key" ON "GoogleCalendarEvent"("userId", "scheduledHuddleId");

-- AddForeignKey
ALTER TABLE "GoogleCalendarLink" ADD CONSTRAINT "GoogleCalendarLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

