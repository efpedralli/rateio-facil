-- CreateEnum
CREATE TYPE "PendenciaScope" AS ENUM ('UNIT', 'CONDOMINIO');

-- AlterTable
ALTER TABLE "RateioPendencia" ADD COLUMN     "scope" "PendenciaScope" NOT NULL DEFAULT 'UNIT',
ADD COLUMN     "unidadeId" TEXT;
