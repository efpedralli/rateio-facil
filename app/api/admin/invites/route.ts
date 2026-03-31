import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuthGuardError, requireRole } from "@/lib/auth";
import { AuditEvent, UserRole, prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function authErrorToResponse(error: unknown) {
  if (error instanceof AuthGuardError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([UserRole.ADMIN]);
    const rawToken = crypto.randomBytes(INVITE_TOKEN_BYTES).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const invite = await prisma.inviteToken.create({
      data: {
        tokenHash,
        role: UserRole.OPERATOR,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdByUserId: session.user.id,
      },
    });

    await writeAudit(AuditEvent.INVITE_CREATED, {
      userId: session.user.id,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      metadata: { inviteId: invite.id, role: UserRole.OPERATOR },
    });

    const inviteUrl = new URL("/invite", req.url);
    inviteUrl.searchParams.set("token", rawToken);

    return NextResponse.json({
      ok: true,
      inviteId: invite.id,
      expiresAt: invite.expiresAt.toISOString(),
      inviteLink: inviteUrl.toString(),
    });
  } catch (error) {
    return authErrorToResponse(error);
  }
}
