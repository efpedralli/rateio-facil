-- CreateEnum
CREATE TYPE "PendenciaStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "RateioPendencia" (
    "id" TEXT NOT NULL,
    "rateioId" TEXT NOT NULL,
    "condominioId" TEXT NOT NULL,
    "rawDesc" TEXT NOT NULL,
    "normDesc" TEXT NOT NULL,
    "exampleValue" DOUBLE PRECISION,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "status" "PendenciaStatus" NOT NULL DEFAULT 'OPEN',
    "suggestedItem" INTEGER,
    "resolvedItem" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RateioPendencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateioPendencia_condominioId_status_idx" ON "RateioPendencia"("condominioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RateioPendencia_rateioId_normDesc_key" ON "RateioPendencia"("rateioId", "normDesc");

-- AddForeignKey
ALTER TABLE "RateioPendencia" ADD CONSTRAINT "RateioPendencia_rateioId_fkey" FOREIGN KEY ("rateioId") REFERENCES "Rateios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateioPendencia" ADD CONSTRAINT "RateioPendencia_condominioId_fkey" FOREIGN KEY ("condominioId") REFERENCES "Condominio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
