import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/multitenant";

export async function GET() {
  try {
    const { tenant, prisma } = await getTenantContext();

    const dbCheck = await prisma.$queryRaw`SELECT 1 as ok`;

    return NextResponse.json({
      ok: true,
      host: tenant.host,
      slug: tenant.slug,
      db: tenant.db_name,
      uploadDir: tenant.upload_dir,
      dbCheck,
    });
  } catch (error) {
    console.error("ERRO /api/health:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
        stack: error instanceof Error ? error.stack : null,
      },
      { status: 500 }
    );
  }
}