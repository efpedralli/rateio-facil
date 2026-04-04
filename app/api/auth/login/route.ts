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

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeCallbackUrl(String(formData.get("callbackUrl") ?? "/dashboard"));

  const authenticated = await authenticateCredentials({
    email,
    password,
    headers: req.headers,
  });

  if (!authenticated) {
    const redirectUrl = new URL("/login", req.url);
    redirectUrl.searchParams.set("error", "Invalid credentials");
    redirectUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(redirectUrl);
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  const { prisma } = await getTenantContext();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: authenticated.id,
      expires,
    },
  });

  const resolvedCallbackUrl = callbackUrl === "/admin/users" && authenticated.role !== "ADMIN"
    ? "/dashboard"
    : callbackUrl;

  const response = NextResponse.redirect(new URL(resolvedCallbackUrl, req.url));
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
