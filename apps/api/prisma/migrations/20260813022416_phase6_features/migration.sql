-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "dailyDigestOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "digestLastOn" TEXT;

-- CreateIndex
CREATE INDEX "Decision_ownerId_idx" ON "Decision"("ownerId");

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
