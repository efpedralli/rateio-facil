import type { NextRequest } from "next/server";

type HeaderLike = Headers | Record<string, string | string[] | undefined>;
type HeaderSource = NextRequest | HeaderLike;

function normalizeRecordHeaders(
  record: Record<string, string | string[] | undefined>
): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

function getHeaders(input: HeaderSource): Headers {
  if (input instanceof Headers) {
    return input;
  }
  if ("headers" in input && input.headers instanceof Headers) {
    return input.headers;
  }
  return normalizeRecordHeaders(input as Record<string, string | string[] | undefined>);
}

export function getClientIp(input: HeaderSource): string | null {
  const headers = getHeaders(input);
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  return null;
}

export function getUserAgent(input: HeaderSource): string | null {
  const headers = getHeaders(input);
  return headers.get("user-agent");
}
