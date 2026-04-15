import { controlPool } from "./control-db";

export type TenantConfig = {
  id: number;
  slug: string;
  host: string;
  company_name: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  db_name: string;
  db_user: string;
  db_password: string;
  db_host: string;
  db_port: number;
  upload_dir: string;
  log_dir: string;
  mail_from_name: string | null;
  mail_from_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  smtp_user: string | null;
  smtp_password: string | null;
  active: boolean;
};

const LOCAL_FALLBACK_HOST: string | null = null;

function normalizeHost(host?: string | null): string {
  if (!host) return "";
  return host.split(":")[0].trim().toLowerCase();
}

function resolveEffectiveHost(rawHost?: string | null): string | null {
  const normalized = normalizeHost(rawHost);

  if (normalized) {
    return normalized;
  }

  if (process.env.NODE_ENV === "development") {
    return LOCAL_FALLBACK_HOST;
  }

  return null;
}

const tenantCache = new Map<string, TenantConfig>();

export async function getTenantByHost(rawHost?: string | null): Promise<TenantConfig | null> {
  const effectiveHost = resolveEffectiveHost(rawHost);

  if (!effectiveHost) {
    return null;
  }

  const cached = tenantCache.get(effectiveHost);
  if (cached) return cached;

  const { rows } = await controlPool.query<TenantConfig>(
    `
      SELECT *
      FROM tenants
      WHERE host = $1
        AND active = true
      LIMIT 1
    `,
    [effectiveHost]
  );

  const tenant = rows[0] ?? null;

  if (tenant) {
    tenantCache.set(effectiveHost, tenant);
  }

  return tenant;
}

export function clearTenantCache(host?: string | null): void {
  if (!host) {
    tenantCache.clear();
    return;
  }

  const effectiveHost = resolveEffectiveHost(host);

  if (!effectiveHost) {
    return;
  }

  tenantCache.delete(effectiveHost);
}
