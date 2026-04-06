import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs/promises";
import path from "path";
import { createAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { CanonicalBalanceteExportPayload } from "@/lib/balancete/canonical-export-payload";
import { isPathUnderBalanceteJobDir } from "@/lib/balancete/balancete-job-paths";
import { runBalanceteExportSeensXlsx } from "@/lib/balancete/python-runner";
import {
  buildSeensOutputRelativePath,
  isPathUnderOutputs,
} from "@/lib/balancete/seens-export-path";

export const runtime = "nodejs";

function isPayloadShape(x: unknown): x is CanonicalBalanceteExportPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.metadata === "object" &&
    o.metadata !== null &&
    Array.isArray(o.entries) &&
    typeof o.summary === "object" &&
    o.summary !== null &&
    Array.isArray(o.accounts)
  );
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(createAuthOptions(prisma));
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const job = await prisma.balanceteJob.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!job || job.status !== "COMPLETED") {
    return NextResponse.json({ ok: false, error: "Processamento não disponível." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 });
  }

  if (!isPayloadShape(body)) {
    return NextResponse.json({ ok: false, error: "Payload inválido." }, { status: 400 });
  }

  const payload = body;
  const cwd = process.cwd();
  const jobDir = path.join(cwd, "uploads", "balancetes", id);
  const jsonPath = path.join(jobDir, "canonical_export_edited.json");
  if (!isPathUnderBalanceteJobDir(cwd, id, jsonPath)) {
    return NextResponse.json({ ok: false, error: "Caminho inválido." }, { status: 400 });
  }

  const seensRel = buildSeensOutputRelativePath(
    payload.metadata.condominio,
    payload.metadata.competencia,
    payload.metadata.periodo_inicio
  );
  const seensAbs = path.join(cwd, ...seensRel.split("/").filter(Boolean));
  if (!isPathUnderOutputs(cwd, seensAbs)) {
    return NextResponse.json({ ok: false, error: "Saída inválida." }, { status: 400 });
  }

  try {
    await fs.writeFile(jsonPath, JSON.stringify(payload), "utf-8");
    await runBalanceteExportSeensXlsx(jsonPath, seensAbs);
    const buf = await fs.readFile(seensAbs);
    const safeName = path.basename(seensAbs) || "modelo_seens.xlsx";

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar XLSX.";
    return NextResponse.json({ ok: false, error: msg.slice(0, 800) }, { status: 500 });
  }
}
