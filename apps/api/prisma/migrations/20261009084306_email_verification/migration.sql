-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- People whose SSO identity provider already vouched for their address count as
-- verified. (An Atlassian account link does NOT: it can be connected to an
-- existing account with a different email.)
UPDATE "User" SET "emailVerifiedAt" = NOW()
WHERE "id" IN (SELECT "userId" FROM "SsoIdentity");