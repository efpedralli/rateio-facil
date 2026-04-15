import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  authenticateCredentials,
} from "@/lib/auth";
import { getTenantContext } from "@/lib/multitenant";

export const runtime = "nodejs";

function safeCallbackUrl(input: string): string {
  if (input.startsWith("/") && !input.startsWith("//")) {
    return input;
  }
  return "/dashboard";
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
  const formData = await req.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeCallbackUrl(String(formData.get("callbackUrl") ?? "/dashboard"));
const baseUrl = getPublicBaseUrl(req);
  const { prisma } = await getTenantContext();
  const authenticated = await authenticateCredentials(prisma, {
    email,
    password,
    headers: req.headers,
  });

  if (!authenticated) {
const redirectUrl = new URL("/login", baseUrl);
    redirectUrl.searchParams.set("error", "Invalid credentials");
    redirectUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(redirectUrl);
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: {
      id: crypto.randomUUID(),
      sessionToken,
      userId: authenticated.id,
      expires,
    },
  });

  const resolvedCallbackUrl = callbackUrl === "/admin/users" && authenticated.role !== "ADMIN"
    ? "/dashboard"
    : callbackUrl;

  const response = NextResponse.redirect(new URL(resolvedCallbackUrl, baseUrl));
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    expires,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
