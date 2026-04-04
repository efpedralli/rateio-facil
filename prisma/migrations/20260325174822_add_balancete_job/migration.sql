-- CreateEnum
CREATE TYPE "BalanceteJobStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "BalanceteJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BalanceteJobStatus" NOT NULL DEFAULT 'RECEIVED',
    "originalName" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "xlsxPath" TEXT,
    "summary" JSONB,
    "issues" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BalanceteJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceteJob_userId_createdAt_idx" ON "BalanceteJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BalanceteJob" ADD CONSTRAINT "BalanceteJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
