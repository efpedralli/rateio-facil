import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
  console.log("🌱 Seed Ilhas do Caribe (01/2026) ...");

  // (Opcional) LIMPA tudo para evitar duplicidade enquanto está em dev.
  // Se você não quiser apagar, comente esses deletes.
  await prisma.rateioUnidadeDado.deleteMany({});
  await prisma.rateioUnidade.deleteMany({});
  await prisma.rateioCampo.deleteMany({});
  await prisma.rateioArquivo.deleteMany({});
  await prisma.rateios.deleteMany({});
  await prisma.itensRateio.deleteMany({});
  await prisma.unidade.deleteMany({});
  await prisma.condominio.deleteMany({});

  // Condomínio real do PDF
  const condominio = await prisma.condominio.create({
    data: {
      externalId: "ILHAS-DO-CARIBE",
      nome: "RESIDENCIAL ILHAS DO CARIBE",
    },
  });

  console.log("✔ Condomínio:", condominio.id);

  // Unidades extraídas do PDF (95)
  const unidadesData = [
    { externalId: "ILHAS-01-101", bloco: "01", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-01-102", bloco: "01", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-01-103", bloco: "01", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-01-104", bloco: "01", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-01-201", bloco: "01", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-01-202", bloco: "01", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-01-203", bloco: "01", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-01-204", bloco: "01", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-01-301", bloco: "01", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-01-302", bloco: "01", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-01-303", bloco: "01", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-01-304", bloco: "01", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-02-101", bloco: "02", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-02-102", bloco: "02", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-02-103", bloco: "02", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-02-104", bloco: "02", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-02-201", bloco: "02", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-02-202", bloco: "02", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-02-203", bloco: "02", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-02-204", bloco: "02", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-02-301", bloco: "02", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-02-302", bloco: "02", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-02-303", bloco: "02", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-02-304", bloco: "02", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-03-101", bloco: "03", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-03-102", bloco: "03", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-03-103", bloco: "03", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-03-104", bloco: "03", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-03-201", bloco: "03", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-03-202", bloco: "03", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-03-203", bloco: "03", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-03-204", bloco: "03", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-03-301", bloco: "03", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-03-302", bloco: "03", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-03-303", bloco: "03", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-03-304", bloco: "03", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-04-101", bloco: "04", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-04-102", bloco: "04", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-04-103", bloco: "04", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-04-104", bloco: "04", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-04-201", bloco: "04", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-04-202", bloco: "04", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-04-203", bloco: "04", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-04-204", bloco: "04", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-04-301", bloco: "04", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-04-302", bloco: "04", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-04-303", bloco: "04", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-04-304", bloco: "04", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-05-101", bloco: "05", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-05-102", bloco: "05", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-05-103", bloco: "05", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-05-104", bloco: "05", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-05-201", bloco: "05", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-05-202", bloco: "05", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-05-203", bloco: "05", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-05-204", bloco: "05", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-05-301", bloco: "05", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-05-302", bloco: "05", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-05-303", bloco: "05", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-05-304", bloco: "05", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-06-101", bloco: "06", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-06-102", bloco: "06", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-06-103", bloco: "06", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-06-104", bloco: "06", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-06-201", bloco: "06", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-06-202", bloco: "06", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-06-203", bloco: "06", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-06-204", bloco: "06", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-06-301", bloco: "06", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-06-302", bloco: "06", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-06-303", bloco: "06", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-06-304", bloco: "06", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-07-101", bloco: "07", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-07-102", bloco: "07", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-07-103", bloco: "07", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-07-104", bloco: "07", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-07-201", bloco: "07", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-07-202", bloco: "07", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-07-203", bloco: "07", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-07-204", bloco: "07", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-07-301", bloco: "07", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-07-302", bloco: "07", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-07-303", bloco: "07", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-07-304", bloco: "07", unidade: "304", condominioId: condominio.id },

    { externalId: "ILHAS-08-101", bloco: "08", unidade: "101", condominioId: condominio.id },
    { externalId: "ILHAS-08-102", bloco: "08", unidade: "102", condominioId: condominio.id },
    { externalId: "ILHAS-08-103", bloco: "08", unidade: "103", condominioId: condominio.id },
    { externalId: "ILHAS-08-104", bloco: "08", unidade: "104", condominioId: condominio.id },
    { externalId: "ILHAS-08-201", bloco: "08", unidade: "201", condominioId: condominio.id },
    { externalId: "ILHAS-08-202", bloco: "08", unidade: "202", condominioId: condominio.id },
    { externalId: "ILHAS-08-203", bloco: "08", unidade: "203", condominioId: condominio.id },
    { externalId: "ILHAS-08-204", bloco: "08", unidade: "204", condominioId: condominio.id },
    { externalId: "ILHAS-08-301", bloco: "08", unidade: "301", condominioId: condominio.id },
    { externalId: "ILHAS-08-302", bloco: "08", unidade: "302", condominioId: condominio.id },
    { externalId: "ILHAS-08-303", bloco: "08", unidade: "303", condominioId: condominio.id },
    { externalId: "ILHAS-08-304", bloco: "08", unidade: "304", condominioId: condominio.id },
  ];

  await prisma.unidade.createMany({ data: unidadesData });
  console.log("✔ Unidades criadas:", unidadesData.length);

  // ItensRateio (do seu exemplo /api/BuscaItensRateio)
  const itensRaw = [
    { item: 39, descricao: "Abono Pix", opcoes: [] },
    { item: 35, descricao: "Água", opcoes: ["Consumo (Água)"] },
    { item: 22, descricao: "Cancelamento de Reserva", opcoes: ["Excluir de Repasses", "Não Antecipar"] },
    { item: 16, descricao: "Chaves", opcoes: [] },
    { item: 17, descricao: "Churrasqueira", opcoes: [] },
    { item: 18, descricao: "Controle", opcoes: [] },
    { item: 13, descricao: "Diferença de Pagamento a Maior", opcoes: [] },
    { item: 12, descricao: "Diferença de Pagamento a Menor", opcoes: [] },
    { item: 2, descricao: "Fundo de Contingência", opcoes: [] },
    { item: 3, descricao: "Fundo de Investimento", opcoes: [] },
    { item: 4, descricao: "Fundo de Manutenção", opcoes: [] },
    { item: 5, descricao: "Fundo de Melhorias", opcoes: [] },
    { item: 6, descricao: "Fundo de Obras", opcoes: [] },
    { item: 1, descricao: "Fundo de Reservas", opcoes: [] },
    { item: 7, descricao: "Fundo de RH", opcoes: [] },
    { item: 19, descricao: "Garagem", opcoes: [] },
    { item: 36, descricao: "Gás", opcoes: ["Consumo (Gás)"] },
    { item: 15, descricao: "Jardinagem", opcoes: [] },
    { item: 20, descricao: "Limpeza", opcoes: [] },
    { item: 21, descricao: "Manutenção", opcoes: [] },
    { item: 14, descricao: "Multa", opcoes: [] },
    { item: 9, descricao: "Taxa Boleto", opcoes: [] },
    { item: 8, descricao: "Taxa de Condomínio", opcoes: [] },
    { item: 10, descricao: "Taxa de Serviço", opcoes: [] },
    { item: 11, descricao: "Taxa Envio Correios", opcoes: [] },
    { item: 12, descricao: "Seguro", opcoes: [] },
    { item: 40, descricao: "Honorários", opcoes: [] },
    { item: 37, descricao: "Portaria", opcoes: [] },
    { item: 42, descricao: "Energia", opcoes: [] },
  ];

  const seenItems = new Set<number>();
  const itens = itensRaw
    .filter((x) => {
      if (seenItems.has(x.item)) return false;
      seenItems.add(x.item);
      return true;
    })
    .map((x) => ({ ...x, condominioId: condominio.id }));

  await prisma.itensRateio.createMany({ data: itens, skipDuplicates: true });
  console.log("✔ ItensRateio criados:", itens.length);

  console.log("✅ Seed finalizado!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });