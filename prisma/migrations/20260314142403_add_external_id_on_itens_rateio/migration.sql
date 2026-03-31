-- AlterTable
ALTER TABLE "ItensRateio" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "ItensRateio_condominioId_externalId_idx" ON "ItensRateio"("condominioId", "externalId");
