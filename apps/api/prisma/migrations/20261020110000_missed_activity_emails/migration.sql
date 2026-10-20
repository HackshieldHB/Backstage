-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastMissedEmailAt" TIMESTAMP(3),
ADD COLUMN     "missedActivityEmails" BOOLEAN NOT NULL DEFAULT true;

