-- AlterTable
ALTER TABLE "AtlassianAccountLink" ALTER COLUMN "accessTokenEnc" DROP NOT NULL,
ALTER COLUMN "refreshTokenEnc" DROP NOT NULL,
ALTER COLUMN "scopes" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "unfurls" JSONB;

-- CreateTable
CREATE TABLE "AtlassianConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "webhookSecret" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtlassianConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelJiraSubscription" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "events" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelJiraSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraIssueCard" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JiraIssueCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtlassianConnection_workspaceId_key" ON "AtlassianConnection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelJiraSubscription_channelId_projectKey_key" ON "ChannelJiraSubscription"("channelId", "projectKey");

-- CreateIndex
CREATE UNIQUE INDEX "JiraIssueCard_messageId_key" ON "JiraIssueCard"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "JiraIssueCard_channelId_issueKey_key" ON "JiraIssueCard"("channelId", "issueKey");

-- AddForeignKey
ALTER TABLE "AtlassianConnection" ADD CONSTRAINT "AtlassianConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtlassianConnection" ADD CONSTRAINT "AtlassianConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelJiraSubscription" ADD CONSTRAINT "ChannelJiraSubscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelJiraSubscription" ADD CONSTRAINT "ChannelJiraSubscription_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AtlassianConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraIssueCard" ADD CONSTRAINT "JiraIssueCard_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AtlassianConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraIssueCard" ADD CONSTRAINT "JiraIssueCard_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraIssueCard" ADD CONSTRAINT "JiraIssueCard_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

