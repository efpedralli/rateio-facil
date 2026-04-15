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
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const redirectUrl = new URL("/reset-password", req.url);
  redirectUrl.searchParams.set("token", token);

  if (!token || !password || !confirmPassword) {
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
  const resetToken = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    include: { user: true },
  });

  if (!resetToken || !resetToken.user.isActive) {
    redirectUrl.searchParams.set("error", "Invalid or expired token.");
    return NextResponse.redirect(redirectUrl);
  }

  const nextPasswordHash = await hashPassword(password);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash: nextPasswordHash,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
      },
      data: { usedAt: now },
    }),
    prisma.session.deleteMany({
      where: { userId: resetToken.userId },
    }),
  ]);

  await writeAudit(prisma, AuditEvent.PASSWORD_RESET_SUCCESS, {
    userId: resetToken.userId,
    ip,
    userAgent,
  });

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("message", "Password updated. Sign in again.");
  return NextResponse.redirect(loginUrl);
}
