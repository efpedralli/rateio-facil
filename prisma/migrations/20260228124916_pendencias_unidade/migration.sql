/*
  Warnings:

  - A unique constraint covering the columns `[rateioId,unidadeId,normDesc]` on the table `RateioPendencia` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "RateioPendencia_rateioId_unidadeId_normDesc_key" ON "RateioPendencia"("rateioId", "unidadeId", "normDesc");
