import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/multitenant";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const { prisma } = await getTenantContext();
  const rateio = await prisma.rateios.findUnique({
    where: { id },
    include: {
      condominio: true,
      rateioCampos: true,
      rateioUnidades: {
        include: {
          unidade: true,
          rateioUnidadeDados: true,
        },
      },
    },
  });

  if (!rateio) {
    return NextResponse.json(
      { ok: false, error: "Rateio não encontrado" },
      { status: 404 }
    );
  }

  // Busca descrições dos itens do condomínio
  const itens = await prisma.itensRateio.findMany({
    where: { condominioId: rateio.condominioId },
  });

  const itemMap = new Map(
    itens.map((i) => [i.item, i.descricao])
  );

  const campoMap = new Map(
    rateio.rateioCampos.map((c) => [c.ordem, c.item])
  );

  const agg = await prisma.rateioUnidade.aggregate({
    where: { rateioId: rateio.id },
    _sum: { value: true },
    _count: { _all: true },
  });

  const unidades = rateio.rateioUnidades.map((ru) => {
    const composicao = ru.rateioUnidadeDados
      .map((dado) => {
        const item = campoMap.get(dado.ordem);

        return {
          ordem: dado.ordem,
          item,
          descricao: itemMap.get(item ?? 0) ?? null,
          valor: dado.valor,
          parcela: dado.parcela,
          parcelas: dado.parcelas,
        };
      })
      .sort((a, b) => a.ordem - b.ordem);

    return {
      bloco: ru.unidade.bloco,
      unidade: ru.unidade.unidade,
      total: ru.value,
      composicao,
    };
  });

  return NextResponse.json({
    ok: true,
    id: rateio.id,
    competencia: rateio.competencia,
    total: {
      parsed: Number(agg._sum.value ?? 0),
      unitsCount: agg._count._all,
    },
    condominio: rateio.condominio.nome,
    status: rateio.status,
    unidades,
  });
}