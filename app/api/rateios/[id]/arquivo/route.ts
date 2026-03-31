import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { AuthGuardError, requireRole } from "@/lib/auth";
import { UserRole, prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function authErrorToResponse(error: unknown) {
  if (error instanceof AuthGuardError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }

  return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole([UserRole.ADMIN, UserRole.OPERATOR]);
    const { id } = await ctx.params;

    const rateio = await prisma.rateios.findUnique({
      where: { id },
      include: { rateioArquivos: true },
    });

    if (!rateio) {
      return NextResponse.json({ ok: false, error: "Rateio não encontrado" }, { status: 404 });
    }

    const arquivo = rateio.rateioArquivos[0];
    if (!arquivo) {
      return NextResponse.json({ ok: false, error: "Arquivo não encontrado" }, { status: 404 });
    }

    const absolutePath = path.join(process.cwd(), arquivo.path);
    const bytes = await fs.readFile(absolutePath);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": arquivo.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(arquivo.originalName)}"`,
      },
    });
  } catch (error) {
    return authErrorToResponse(error);
  }
}
