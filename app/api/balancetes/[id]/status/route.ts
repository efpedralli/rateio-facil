import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createAuthOptions } from "@/lib/auth";
import { getTenantContext } from "@/lib/multitenant";
import type { BalanceteJobSummary } from "@/lib/balancete/types";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { prisma } = await getTenantContext();
  const session = await getServerSession(createAuthOptions(prisma));
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const job = await prisma.balanceteJob.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!job) {
    return NextResponse.json({ ok: false, error: "Processamento não encontrado." }, { status: 404 });
  }

  const downloadUrl =
    job.status === "COMPLETED" && job.xlsxPath
      ? `/api/balancetes/${encodeURIComponent(job.id)}/download`
      : null;

  const summary = job.summary as BalanceteJobSummary | null;

  return NextResponse.json({
    ok: true,
    id: job.id,
    status: job.status,
    summary: job.summary,
    issues: job.issues,
    validationSummary: summary?.validationSummary ?? null,
    errorMessage: job.errorMessage,
    downloadUrl,
    originalName: job.originalName,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}
