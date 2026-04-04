import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { TenantConfig } from "./tenant-resolver";

const prismaCache = new Map<string, PrismaClient>();

function buildTenantDatabaseUrl(tenant: TenantConfig) {
  const user = encodeURIComponent(tenant.db_user);
  const pass = encodeURIComponent(tenant.db_password);
  const host = tenant.db_host;
  const port = tenant.db_port;
  const db = tenant.db_name;

  return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

export function getTenantPrisma(tenant: TenantConfig) {
  const cacheKey = tenant.slug;

  const existing = prismaCache.get(cacheKey);
  if (existing) return existing;

  const connectionString = buildTenantDatabaseUrl(tenant);
  const adapter = new PrismaPg({ connectionString });

  const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  prismaCache.set(cacheKey, prisma);
  return prisma;
}