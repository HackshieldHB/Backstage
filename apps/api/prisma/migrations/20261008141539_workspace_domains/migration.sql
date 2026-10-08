-- AlterTable
ALTER TABLE "SsoConnection" DROP COLUMN "emailDomains";

-- CreateTable
CREATE TABLE "WorkspaceDomain" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceDomain_domain_idx" ON "WorkspaceDomain"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceDomain_workspaceId_domain_key" ON "WorkspaceDomain"("workspaceId", "domain");

-- AddForeignKey
ALTER TABLE "WorkspaceDomain" ADD CONSTRAINT "WorkspaceDomain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A domain can be verified by at most one workspace (partial unique: pending claims may overlap).
CREATE UNIQUE INDEX "WorkspaceDomain_domain_verified_key" ON "WorkspaceDomain"("domain") WHERE "verifiedAt" IS NOT NULL;
