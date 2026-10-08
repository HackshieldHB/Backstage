-- CreateTable
CREATE TABLE "ChannelShare" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "hostWorkspaceId" TEXT NOT NULL,
    "guestWorkspaceId" TEXT,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelShare_inviteTokenHash_key" ON "ChannelShare"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "ChannelShare_channelId_idx" ON "ChannelShare"("channelId");

-- CreateIndex
CREATE INDEX "ChannelShare_guestWorkspaceId_idx" ON "ChannelShare"("guestWorkspaceId");

-- AddForeignKey
ALTER TABLE "ChannelShare" ADD CONSTRAINT "ChannelShare_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelShare" ADD CONSTRAINT "ChannelShare_hostWorkspaceId_fkey" FOREIGN KEY ("hostWorkspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelShare" ADD CONSTRAINT "ChannelShare_guestWorkspaceId_fkey" FOREIGN KEY ("guestWorkspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live share per (channel, partner); revoked shares are kept for history.
CREATE UNIQUE INDEX "ChannelShare_live_partner_key" ON "ChannelShare"("channelId", "guestWorkspaceId") WHERE "revokedAt" IS NULL AND "guestWorkspaceId" IS NOT NULL;
