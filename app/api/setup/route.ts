import { NextRequest, NextResponse } from "next/server";
import { AuditEvent, UserRole, prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordStrength } from "@/lib/security/password";
import { getClientIp, getUserAgent } from "@/lib/request";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const secret = String(formData.get("secret") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const redirectUrl = new URL("/setup", req.url);
  redirectUrl.searchParams.set("secret", secret);

  if (!secret || !email || !password || !confirmPassword) {
    redirectUrl.searchParams.set("error", "Invalid request.");
    return NextResponse.redirect(redirectUrl);
  }

  if (secret !== process.env.SETUP_SECRET) {
    redirectUrl.searchParams.set("error", "Setup is not available.");
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

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    redirectUrl.searchParams.set("error", "Setup is already completed.");
    return NextResponse.redirect(redirectUrl);
  }

  const passwordHash = await hashPassword(password);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  await writeAudit(AuditEvent.USER_CREATED, {
    userId: admin.id,
    ip,
    userAgent,
    metadata: { source: "setup", role: UserRole.ADMIN },
  });

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("message", "Admin created. Sign in.");
  return NextResponse.redirect(loginUrl);
}
