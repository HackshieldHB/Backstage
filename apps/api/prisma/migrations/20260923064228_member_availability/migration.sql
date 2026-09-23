-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "oooMessage" TEXT,
ADD COLUMN     "oooUntil" TIMESTAMP(3),
ADD COLUMN     "workDays" TEXT,
ADD COLUMN     "workEndMin" INTEGER,
ADD COLUMN     "workStartMin" INTEGER;
