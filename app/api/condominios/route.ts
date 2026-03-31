import { NextResponse } from "next/server";
import { AuthGuardError, requireRole } from "@/lib/auth";
import { UserRole, prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function authErrorToResponse(error: unknown) {
  if (error instanceof AuthGuardError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }

  return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
}

export async function GET() {
  try {
    await requireRole([UserRole.ADMIN, UserRole.OPERATOR]);

    const condominios = await prisma.condominio.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        externalId: true,
        nome: true,
      },
      orderBy: { nome: "asc" },
    });

    return NextResponse.json({ ok: true, condominios });
  } catch (error) {
    return authErrorToResponse(error);
  }
}
