import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/multitenant";
import { launchRateioVouch } from "@/lib/vouch/submit-rateio";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    const { prisma } = await getTenantContext();
    const rateio = await prisma.rateios.findUnique({
      where: { id },
      include: {
        condominio: true,
        rateioCampos: {
          orderBy: { ordem: "asc" },
        },
        rateioUnidades: {
          include: {
            unidade: true,
            rateioUnidadeDados: {
              orderBy: { ordem: "asc" },
            },
          },
        },
      },
    });

    if (!rateio) {
      return NextResponse.json(
        { ok: false, error: "Rateio não encontrado." },
        { status: 404 }
      );
    }

    const itens = await prisma.itensRateio.findMany({
      where: { condominioId: rateio.condominioId },
      orderBy: { item: "asc" },
    });

    const itemMap = new Map(
      itens.map((it) => [it.item, { descricao: it.descricao }])
    );

    const campos = rateio.rateioCampos.map((campo) => ({
      ordem: campo.ordem,
      item: campo.item,
      descricao: itemMap.get(campo.item)?.descricao ?? `Item ${campo.item}`,
      antecipa: campo.antecipa,
      repassa: campo.repassa,
      parcela: campo.parcela,
      parcelas: campo.parcelas,
    }));

    const unidades = rateio.rateioUnidades.map((ru) => ({
      bloco: ru.unidade.bloco ?? "",
      unidade: ru.unidade.unidade ?? "",
      total: Number(ru.value ?? 0),
      composicao: ru.rateioUnidadeDados.map((dado) => {
        const campo = campos.find((c) => c.ordem === dado.ordem);

        return {
          ordem: dado.ordem,
          item: campo?.item ?? 0,
          descricao: campo?.descricao ?? `Item ordem ${dado.ordem}`,
          valor: Number(dado.valor ?? 0),
          parcela: dado.parcela,
          parcelas: dado.parcelas,
        };
      }),
    }));

    const payload = {
      rateioId: rateio.id,
      condominioNome: rateio.condominio.nome,
      competencia: String(rateio.competencia),
      campos,
      unidades,
    };

    const result = await launchRateioVouch(payload);

    if (result.success) {
      await prisma.rateios.update({
        where: { id: rateio.id },
        data: {
          status: "SENT",
          sentDate: new Date(),
        },
      });
    } else {
      await prisma.rateios.update({
        where: { id: rateio.id },
        data: {
          status: "FAILED",
        },
      });
    }

    return NextResponse.json({
      ok: result.success,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}