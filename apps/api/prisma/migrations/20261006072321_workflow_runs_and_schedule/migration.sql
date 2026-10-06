-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "runCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduleCursor" TIMESTAMP(3);
