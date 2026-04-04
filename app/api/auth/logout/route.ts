import { NextRequest, NextResponse } from "next/server";
import { AuditEvent } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import { getAuthSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getClientIp, getUserAgent } from "@/lib/request";

export const runtime = "nodejs";

const SESSION_COOKIE_CANDIDATES = [
  "__Secure-next-auth.session-token",
  "next-auth.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

function getSessionToken(req: NextRequest): string | null {
  for (const name of SESSION_COOKIE_CANDIDATES) {
    const value = req.cookies.get(name)?.value;
    if (value) return value;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  const sessionToken = getSessionToken(req);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  if (sessionToken) {
    const { prisma } = await getTenantContext();
    await prisma.session.deleteMany({
      where: { sessionToken },
    });
  }

  if (session?.user?.id) {
    await writeAudit(AuditEvent.LOGOUT, {
      userId: session.user.id,
      ip,
      userAgent,
    });
  }

  const response = NextResponse.redirect(new URL("/login", req.url));
  for (const name of SESSION_COOKIE_CANDIDATES) {
    response.cookies.set({
      name,
      value: "",
      expires: new Date(0),
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return response;
}
