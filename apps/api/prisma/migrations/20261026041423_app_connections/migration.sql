-- CreateTable
CREATE TABLE "AppConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretEnc" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppConnection_workspaceId_appId_key" ON "AppConnection"("workspaceId", "appId");

-- AddForeignKey
ALTER TABLE "AppConnection" ADD CONSTRAINT "AppConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
