import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { AuditEvent } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import { writeAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/request";

export const runtime = "nodejs";

const RESET_TOKEN_BYTES = 32;
const RESET_TTL_MS = 30 * 60 * 1000;

function buildResetLink(req: NextRequest, token: string): string {
  const url = new URL("/reset-password", req.url);
  url.searchParams.set("token", token);
  return url.toString();
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  let devResetLink: string | null = null;

  let auditedUserId: string | null = null;

  if (email) {
    const { prisma } = await getTenantContext();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + RESET_TTL_MS);

      await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
          },
          data: {
            usedAt: new Date(),
          },
        }),
        prisma.passwordResetToken.create({
          data: {
            tokenHash,
            expiresAt,
            userId: user.id,
          },
        }),
      ]);

      devResetLink = buildResetLink(req, rawToken);
      auditedUserId = user.id;
    }
  }

  await writeAudit(AuditEvent.PASSWORD_RESET_REQUEST, {
    userId: auditedUserId,
    ip,
    userAgent,
    metadata: { email },
  });

  const redirectUrl = new URL("/forgot-password", req.url);
  redirectUrl.searchParams.set("ok", "1");
  if (process.env.NODE_ENV !== "production" && devResetLink) {
    redirectUrl.searchParams.set("devLink", devResetLink);
  }

  return NextResponse.redirect(redirectUrl);
}
