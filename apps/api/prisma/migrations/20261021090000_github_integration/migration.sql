-- CreateTable
CREATE TABLE "GithubSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "events" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubCard" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GithubUserLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GithubSubscription_workspaceId_repoFullName_idx" ON "GithubSubscription"("workspaceId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "GithubSubscription_channelId_repoFullName_key" ON "GithubSubscription"("channelId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "GithubCard_messageId_key" ON "GithubCard"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "GithubCard_subscriptionId_kind_number_key" ON "GithubCard"("subscriptionId", "kind", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GithubUserLink_userId_key" ON "GithubUserLink"("userId");

-- AddForeignKey
ALTER TABLE "GithubSubscription" ADD CONSTRAINT "GithubSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubSubscription" ADD CONSTRAINT "GithubSubscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubSubscription" ADD CONSTRAINT "GithubSubscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubCard" ADD CONSTRAINT "GithubCard_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "GithubSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubCard" ADD CONSTRAINT "GithubCard_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubCard" ADD CONSTRAINT "GithubCard_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GithubUserLink" ADD CONSTRAINT "GithubUserLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

