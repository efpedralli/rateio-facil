// lib/tenant-paths.ts
import path from "path";
import fs from "fs/promises";
import type { TenantConfig } from "./tenant-resolver";

export function getTenantUploadPaths(tenant: TenantConfig) {
  return {
    base: tenant.upload_dir,
    original: path.join(tenant.upload_dir, "original"),
    processed: path.join(tenant.upload_dir, "processed"),
    exports: path.join(tenant.upload_dir, "exports"),
    temp: path.join(tenant.upload_dir, "temp"),
  };
}

export async function ensureTenantUploadDirs(tenant: TenantConfig) {
  const dirs = Object.values(getTenantUploadPaths(tenant));
  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}