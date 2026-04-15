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

function getPublicBaseUrl(req: Request) {
  const envBase = process.env.NEXTAUTH_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");

  const xfProto = req.headers.get("x-forwarded-proto");
  const xfHost = req.headers.get("x-forwarded-host");
  const host = xfHost || req.headers.get("host");

  const proto = xfProto || "https";

  if (!host) {
    throw new Error("Host não encontrado");
  }

  return `${proto}://${host}`;
}



export async function POST(req: NextRequest) {
  const { prisma } = await getTenantContext();
  const session = await getAuthSession(prisma);
  const sessionToken = getSessionToken(req);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
const baseUrl = getPublicBaseUrl(req);
  if (sessionToken) {
    await prisma.session.deleteMany({
      where: { sessionToken },
    });
  }

  if (session?.user?.id) {
    await writeAudit(prisma, AuditEvent.LOGOUT, {
      userId: session.user.id,
      ip,
      userAgent,
    });
  }

  const response = NextResponse.redirect(new URL("/login", baseUrl));
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
