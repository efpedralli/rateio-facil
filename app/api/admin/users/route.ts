import { NextRequest, NextResponse } from "next/server";
import { AuthGuardError, requireRole } from "@/lib/auth";
import { AuditEvent, UserRole } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import { getClientIp, getUserAgent } from "@/lib/request";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

function authErrorToResponse(error: unknown) {
  if (error instanceof AuthGuardError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
}

export async function GET() {
  try {
    const { prisma } = await getTenantContext();
    await requireRole(prisma, [UserRole.ADMIN]);
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        lockedUntil: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ ok: true, users });
  } catch (error) {
    return authErrorToResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { prisma } = await getTenantContext();
    const session = await requireRole(prisma, [UserRole.ADMIN]);
    const body = (await req.json()) as { userId?: string; role?: UserRole };

    const userId = String(body.userId ?? "");
    const role = body.role;
    if (!userId || (role !== UserRole.ADMIN && role !== UserRole.OPERATOR)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true },
    });
    if (!current) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }

    if (current.role === role) {
      return NextResponse.json({ ok: true, updated: false });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    await writeAudit(prisma, AuditEvent.USER_ROLE_CHANGED, {
      userId: session.user.id,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      metadata: {
        targetUserId: updated.id,
        targetUserEmail: updated.email,
        fromRole: current.role,
        toRole: updated.role,
      },
    });

    return NextResponse.json({ ok: true, updated: true, user: updated });
  } catch (error) {
    return authErrorToResponse(error);
  }
}
