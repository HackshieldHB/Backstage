-- CreateTable
CREATE TABLE "BitbucketSubscription" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "events" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BitbucketSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BitbucketPrCard" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BitbucketPrCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BitbucketSubscription_channelId_repoFullName_key" ON "BitbucketSubscription"("channelId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "BitbucketPrCard_messageId_key" ON "BitbucketPrCard"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "BitbucketPrCard_channelId_prId_key" ON "BitbucketPrCard"("channelId", "prId");

-- AddForeignKey
ALTER TABLE "BitbucketSubscription" ADD CONSTRAINT "BitbucketSubscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitbucketSubscription" ADD CONSTRAINT "BitbucketSubscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitbucketPrCard" ADD CONSTRAINT "BitbucketPrCard_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BitbucketSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitbucketPrCard" ADD CONSTRAINT "BitbucketPrCard_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BitbucketPrCard" ADD CONSTRAINT "BitbucketPrCard_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
