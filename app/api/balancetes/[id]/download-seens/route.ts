import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs/promises";
import path from "path";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { BalanceteJobSummary } from "@/lib/balancete/types";
import { isPathUnderOutputs } from "@/lib/balancete/seens-export-path";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const job = await prisma.balanceteJob.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!job || job.status !== "COMPLETED" || !job.xlsxPath) {
    return NextResponse.json({ ok: false, error: "Arquivo não disponível." }, { status: 404 });
  }

  const summary = job.summary as BalanceteJobSummary | null;
  const rel = summary?.seensXlsxRelativePath?.trim();
  if (!rel) {
    return NextResponse.json({ ok: false, error: "Modelo Seens não foi gerado." }, { status: 404 });
  }

  const cwd = process.cwd();
  const abs = path.resolve(cwd, rel);
  if (!isPathUnderOutputs(cwd, abs)) {
    return NextResponse.json({ ok: false, error: "Caminho inválido." }, { status: 400 });
  }

  try {
    await fs.access(abs);
  } catch {
    return NextResponse.json({ ok: false, error: "Arquivo ausente no disco." }, { status: 404 });
  }

  const buf = await fs.readFile(abs);
  const baseFromPath = path.basename(abs);
  const safeName = baseFromPath || "modelo_seens.xlsx";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
