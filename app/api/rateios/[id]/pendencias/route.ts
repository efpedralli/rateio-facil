import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/multitenant";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: rateioId } = await ctx.params;

  const { prisma } = await getTenantContext();
  const pendencias = await prisma.rateioPendencia.findMany({
    where: { rateioId, status: "OPEN" },
    orderBy: [{ occurrences: "desc" }, { updatedAt: "desc" }],
    include: {unidade: true},
  });

  return NextResponse.json({ ok: true, pendencias });
}