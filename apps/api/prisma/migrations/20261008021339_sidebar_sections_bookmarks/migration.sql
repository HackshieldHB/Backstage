-- AlterTable
ALTER TABLE "ChannelMember" ADD COLUMN     "sectionId" TEXT;

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "sectionId" TEXT;

-- CreateTable
CREATE TABLE "SidebarSection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SidebarSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBookmark" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SidebarSection_userId_workspaceId_idx" ON "SidebarSection"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "ChannelBookmark_channelId_position_idx" ON "ChannelBookmark"("channelId", "position");

-- AddForeignKey
ALTER TABLE "ChannelMember" ADD CONSTRAINT "ChannelMember_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "SidebarSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "SidebarSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SidebarSection" ADD CONSTRAINT "SidebarSection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SidebarSection" ADD CONSTRAINT "SidebarSection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookmark" ADD CONSTRAINT "ChannelBookmark_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookmark" ADD CONSTRAINT "ChannelBookmark_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
