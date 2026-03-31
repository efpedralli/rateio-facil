-- AddForeignKey
ALTER TABLE "RateioPendencia" ADD CONSTRAINT "RateioPendencia_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE SET NULL ON UPDATE CASCADE;
