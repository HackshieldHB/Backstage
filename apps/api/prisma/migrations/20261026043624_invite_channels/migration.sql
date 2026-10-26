-- AlterTable
ALTER TABLE "WorkspaceInvite" ADD COLUMN     "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
