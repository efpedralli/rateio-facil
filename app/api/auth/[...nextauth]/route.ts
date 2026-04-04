import NextAuth from "next-auth";
import { createAuthOptions } from "@/lib/auth";
import { getTenantContext } from "@/lib/multitenant";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const { prisma } = await getTenantContext();
  const handler = NextAuth(createAuthOptions(prisma));
  return handler(req, context);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const { prisma } = await getTenantContext();
  const handler = NextAuth(createAuthOptions(prisma));
  return handler(req, context);
}
