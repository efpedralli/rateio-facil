import { NextRequest, NextResponse } from "next/server";
import { getTenantContext } from "@/lib/multitenant";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "Use multipart/form-data" },
      { status: 415 }
    );
  }

  const form = await req.formData();

  const condominioId = form.get("condominioId")?.toString();
  const competenciaStr = form.get("competencia")?.toString();
  const tabelaStr = form.get("tabela")?.toString() ?? "0";

  if (!condominioId) {
    return NextResponse.json({ ok: false, error: "condominioId é obrigatório" }, { status: 400 });
  }
  if (!competenciaStr || !/^\d{6}$/.test(competenciaStr)) {
    return NextResponse.json(
      { ok: false, error: "competencia é obrigatória no formato YYYYMM (ex: 202404)" },
      { status: 400 }
    );
  }

  const competencia = Number(competenciaStr);
  const tabela = Number(tabelaStr || 0);
  const { prisma } = await getTenantContext();
  const condominio = await prisma.condominio.findFirst({
    where: {
      OR: [{ id: condominioId }, { externalId: condominioId }],
    },
    select: { id: true },
  });

  if (!condominio) {
    return NextResponse.json(
      { ok: false, error: "Condomínio não encontrado para o condominioId informado" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file é obrigatório" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = sha256(bytes);

  const uploadsDir = path.join(process.cwd(), "uploads", "rateios");
  await ensureDir(uploadsDir);

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const filename = `${Date.now()}_${hash.slice(0, 12)}_${safeName}`;
  const filePath = path.join(uploadsDir, filename);

  await fs.writeFile(filePath, bytes);

  // Cria Rateio + RateioArquivo
  const rateio = await prisma.rateios.create({
    data: {
      condominioId: condominio.id,
      competencia,
      tabela,
      totalValue: 0,
      dueDate: new Date(),
      status: "RECEIVED",
      intakeDate: new Date(),
      sentDate: new Date(),
      rateioArquivos: {
        create: [
          {
            originalName: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: bytes.length,
            sha256: hash,
            storage: "local",
            path: `uploads/rateios/${filename}`,
            source: "UPLOAD",
          },
        ],
      },
    },
    include: { rateioArquivos: true },
  });

  return NextResponse.json({
    ok: true,
    rateio: {
      id: rateio.id,
      condominioId: rateio.condominioId,
      competencia: rateio.competencia,
      tabela: rateio.tabela,
      status: rateio.status,
      arquivo: rateio.rateioArquivos[0],
    },
  });
}