-- CreateEnum
CREATE TYPE "CalendarVisibility" AS ENUM ('PRIVATE', 'FREE_BUSY', 'DETAILS');

-- AlterTable
ALTER TABLE "SsoIdentity" ADD COLUMN     "label" TEXT;

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "calendarVisibility" "CalendarVisibility" NOT NULL DEFAULT 'PRIVATE';

