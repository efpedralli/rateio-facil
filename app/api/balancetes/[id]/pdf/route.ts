import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs/promises";
import path from "path";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPathUnderBalanceteJobDir } from "@/lib/balancete/balancete-job-paths";

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

  if (!job?.pdfPath) {
    return NextResponse.json({ ok: false, error: "PDF não disponível." }, { status: 404 });
  }

  const cwd = process.cwd();
  const abs = path.resolve(cwd, job.pdfPath);
  if (!isPathUnderBalanceteJobDir(cwd, id, abs)) {
    return NextResponse.json({ ok: false, error: "Caminho inválido." }, { status: 400 });
  }

  try {
    await fs.access(abs);
  } catch {
    return NextResponse.json({ ok: false, error: "Arquivo ausente no disco." }, { status: 404 });
  }

  const buf = await fs.readFile(abs);
  const safeName = (job.originalName || "balancete.pdf").replace(/[^\w.\-()\s]/g, "_") || "balancete.pdf";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(safeName)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
