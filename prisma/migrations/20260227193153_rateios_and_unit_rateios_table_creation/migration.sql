-- CreateTable
CREATE TABLE "Rateios" (
    "id" TEXT NOT NULL,
    "condominioId" TEXT NOT NULL,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "intakeDate" TIMESTAMP(3) NOT NULL,
    "sentDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rateios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateioUnidade" (
    "id" TEXT NOT NULL,
    "rateioId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateioUnidade_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Rateios" ADD CONSTRAINT "Rateios_condominioId_fkey" FOREIGN KEY ("condominioId") REFERENCES "Condominio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateioUnidade" ADD CONSTRAINT "RateioUnidade_rateioId_fkey" FOREIGN KEY ("rateioId") REFERENCES "Rateios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateioUnidade" ADD CONSTRAINT "RateioUnidade_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
