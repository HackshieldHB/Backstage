-- CreateEnum
CREATE TYPE "HuddleRecordingStatus" AS ENUM ('ACTIVE', 'STOPPING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "HuddleRecording" (
    "id" TEXT NOT NULL,
    "egressId" TEXT NOT NULL,
    "huddleKey" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "HuddleRecordingStatus" NOT NULL DEFAULT 'ACTIVE',
    "error" TEXT,
    "messageId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "HuddleRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HuddleRecording_egressId_key" ON "HuddleRecording"("egressId");

-- CreateIndex
CREATE UNIQUE INDEX "HuddleRecording_storageKey_key" ON "HuddleRecording"("storageKey");

-- CreateIndex
CREATE INDEX "HuddleRecording_huddleKey_status_idx" ON "HuddleRecording"("huddleKey", "status");

