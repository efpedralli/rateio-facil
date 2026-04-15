import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuditEvent } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import { writeAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/request";
import { hashPassword, validatePasswordStrength } from "@/lib/security/password";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const redirectUrl = new URL("/invite", req.url);
  redirectUrl.searchParams.set("token", token);

  if (!token || !email || !password || !confirmPassword) {
    redirectUrl.searchParams.set("error", "Invalid request.");
    return NextResponse.redirect(redirectUrl);
  }

  if (password !== confirmPassword) {
    redirectUrl.searchParams.set("error", "Passwords do not match.");
    return NextResponse.redirect(redirectUrl);
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    redirectUrl.searchParams.set("error", passwordError);
    return NextResponse.redirect(redirectUrl);
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();

  const { prisma } = await getTenantContext();
  const inviteToken = await prisma.inviteToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
    },
  });

  if (!inviteToken) {
    redirectUrl.searchParams.set("error", "Invalid or expired invite.");
    return NextResponse.redirect(redirectUrl);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirectUrl.searchParams.set("error", "Invalid invite.");
    return NextResponse.redirect(redirectUrl);
  }

  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        role: inviteToken.role,
        isActive: true,
      },
    });

    await tx.inviteToken.update({
      where: { id: inviteToken.id },
      data: { usedAt: now },
    });

    return created;
  });

  await writeAudit(prisma, AuditEvent.INVITE_USED, {
    userId: user.id,
    ip,
    userAgent,
    metadata: { inviteId: inviteToken.id, role: inviteToken.role },
  });

  await writeAudit(prisma, AuditEvent.USER_CREATED, {
    userId: user.id,
    ip,
    userAgent,
    metadata: { source: "invite" },
  });

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("message", "Account created. Sign in.");
  return NextResponse.redirect(loginUrl);
}
