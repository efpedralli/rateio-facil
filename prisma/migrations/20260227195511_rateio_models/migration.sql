/*
  Warnings:

  - Added the required column `competencia` to the `Rateios` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RateioStatus" AS ENUM ('RECEIVED', 'PARSED', 'VALIDATED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Condominio" ALTER COLUMN "deletedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RateioUnidade" ALTER COLUMN "deletedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Rateios" ADD COLUMN     "competencia" INTEGER NOT NULL,
ADD COLUMN     "status" "RateioStatus" NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN     "tabela" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "deletedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Unidade" ALTER COLUMN "deletedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RateioCampo" (
    "id" TEXT NOT NULL,
    "rateioId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "item" INTEGER NOT NULL,
    "antecipa" BOOLEAN,
    "repassa" BOOLEAN,
    "parcela" INTEGER NOT NULL,
    "parcelas" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RateioCampo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateioUnidadeDado" (
    "id" TEXT NOT NULL,
    "rateioUnidadeId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "parcela" INTEGER NOT NULL,
    "parcelas" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RateioUnidadeDado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateioArquivo" (
    "id" TEXT NOT NULL,
    "rateioId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "source" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateioArquivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItensRateio" (
    "id" TEXT NOT NULL,
    "condominioId" TEXT NOT NULL,
    "item" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "opcoes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItensRateio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateioCampo_rateioId_ordem_key" ON "RateioCampo"("rateioId", "ordem");

-- CreateIndex
CREATE INDEX "RateioArquivo_sha256_idx" ON "RateioArquivo"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ItensRateio_condominioId_item_key" ON "ItensRateio"("condominioId", "item");

-- AddForeignKey
ALTER TABLE "RateioCampo" ADD CONSTRAINT "RateioCampo_rateioId_fkey" FOREIGN KEY ("rateioId") REFERENCES "Rateios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateioUnidadeDado" ADD CONSTRAINT "RateioUnidadeDado_rateioUnidadeId_fkey" FOREIGN KEY ("rateioUnidadeId") REFERENCES "RateioUnidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateioArquivo" ADD CONSTRAINT "RateioArquivo_rateioId_fkey" FOREIGN KEY ("rateioId") REFERENCES "Rateios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItensRateio" ADD CONSTRAINT "ItensRateio_condominioId_fkey" FOREIGN KEY ("condominioId") REFERENCES "Condominio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
