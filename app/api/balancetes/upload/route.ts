import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs/promises";
import path from "path";
import { createAuthOptions } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import { processBalanceteJob } from "@/lib/balancete/engine";

export const runtime = "nodejs";

const LOG = "[balancete][upload]";

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function POST(req: NextRequest) {
  const { prisma } = await getTenantContext();
  const session = await getServerSession(createAuthOptions(prisma));
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Não autenticado." }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "Use multipart/form-data" },
      { status: 415 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Campo file é obrigatório." }, { status: 400 });
  }

  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".pdf")) {
    return NextResponse.json({ ok: false, error: "Envie um arquivo PDF." }, { status: 400 });
  }

  const jobId = randomUUID();
  const relPdf = path.posix.join("uploads", "balancetes", jobId, "entrada.pdf");
  const absPdf = path.join(process.cwd(), relPdf);

  await ensureDir(path.dirname(absPdf));
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absPdf, bytes);

  await prisma.balanceteJob.create({
    data: {
      id: jobId,
      userId: session.user.id,
      status: "PROCESSING",
      originalName: file.name,
      pdfPath: relPdf.replace(/\\/g, "/"),
    },
  });

  const t0 = Date.now();
  console.log(
    `${LOG} job=${jobId} | PDF salvo (${bytes.length} bytes) → ${relPdf} | processamento iniciado`
  );

  try {
    const result = await processBalanceteJob({
      jobId,
      pdfAbsPath: absPdf,
      originalFileName: file.name,
    });

    if (result.blocking) {
      const firstErr = result.issues.find((i) => i.type === "ERROR");
      const errMsg =
        firstErr?.message ??
        "Não foi possível gerar o arquivo de importação. Verifique o PDF, o layout ou o modelo em models/.";

      await prisma.balanceteJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          summary: result.summary as unknown as Prisma.InputJsonValue,
          issues: result.issues as unknown as Prisma.InputJsonValue,
          errorMessage: errMsg,
          xlsxPath: null,
        },
      });

      console.warn(
        `${LOG} job=${jobId} | FALHA (bloqueante) em ${Date.now() - t0}ms | ${errMsg.slice(0, 120)}`
      );

      return NextResponse.json({
        ok: false,
        success: false,
        id: jobId,
        summary: result.summary,
        issues: result.issues,
        validationSummary: result.validationSummary,
        downloadUrl: null,
        error: errMsg,
      });
    }

    console.log(
      `${LOG} job=${jobId} | SUCESSO em ${Date.now() - t0}ms | xlsx=${result.xlsxRelativePath}`
    );

    await prisma.balanceteJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        summary: result.summary as unknown as Prisma.InputJsonValue,
        issues: result.issues as unknown as Prisma.InputJsonValue,
        xlsxPath: result.xlsxRelativePath.replace(/\\/g, "/"),
        errorMessage: null,
      },
    });

    return NextResponse.json({
      ok: true,
      success: true,
      id: jobId,
      summary: result.summary,
      issues: result.issues,
      validationSummary: result.validationSummary,
      downloadUrl: `/api/balancetes/${encodeURIComponent(jobId)}/download`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao processar balancete.";
    console.error(
      `${LOG} job=${jobId} | EXCEÇÃO após ${Date.now() - t0}ms | ${message.slice(0, 500)}`,
      e
    );
    await prisma.balanceteJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
      },
    });

    return NextResponse.json(
      {
        ok: false,
        success: false,
        id: jobId,
        error: "Falha no processamento. Verifique o ambiente Python (venv) e dependências do balancete.",
      },
      { status: 500 }
    );
  }
}
