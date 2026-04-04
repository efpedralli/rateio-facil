// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_INTERNAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
]);

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();

  if (!host) {
    return new NextResponse("Host inválido", { status: 400 });
  }

  if (ALLOWED_INTERNAL_HOSTS.has(host)) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};