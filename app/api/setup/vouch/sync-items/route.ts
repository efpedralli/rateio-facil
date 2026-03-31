import { NextRequest, NextResponse } from "next/server";
import { syncItensFromVouch } from "@/lib/vouch/setup/sync-items";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const condominioId = String(body?.condominioId ?? "");

    if (!condominioId) {
      return NextResponse.json(
        { ok: false, error: "condominioId é obrigatório." },
        { status: 400 }
      );
    }

    const result = await syncItensFromVouch({ condominioId });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}