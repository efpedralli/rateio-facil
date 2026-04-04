// lib/tenant-context.ts
import { headers } from "next/headers";
import { getTenantByHost } from "./tenant-resolver";
import { getTenantPrisma } from "./tenant-prisma";
import { ensureTenantUploadDirs } from "./tenant-paths";

export async function getTenantContext() {
  const hdrs = await headers();
  const host = hdrs.get("host");

  const tenant = await getTenantByHost(host);
  if (!tenant) {
    throw new Error(`Tenant não encontrado para host: ${host}`);
  }

  await ensureTenantUploadDirs(tenant);

  const prisma = getTenantPrisma(tenant);

  return { tenant, prisma };
}