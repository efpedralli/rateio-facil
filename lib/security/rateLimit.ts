import { prisma } from "@/lib/prisma";

type HitRateLimitInput = {
  key: string;
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
};

type HitRateLimitResult = {
  allowed: boolean;
  blockedUntil: Date | null;
  remaining: number;
};

export async function hitRateLimit(
  input: HitRateLimitInput
): Promise<HitRateLimitResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimitBucket.findUnique({
      where: { bucketKey: input.key },
    });

    if (!existing) {
      await tx.rateLimitBucket.create({
        data: {
          bucketKey: input.key,
          count: 1,
          windowStart: now,
          blockedUntil: null,
        },
      });

      return {
        allowed: true,
        blockedUntil: null,
        remaining: Math.max(0, input.maxAttempts - 1),
      };
    }

    if (existing.blockedUntil && existing.blockedUntil > now) {
      return {
        allowed: false,
        blockedUntil: existing.blockedUntil,
        remaining: 0,
      };
    }

    const windowEndsAt = new Date(existing.windowStart.getTime() + input.windowMs);
    if (windowEndsAt <= now) {
      await tx.rateLimitBucket.update({
        where: { id: existing.id },
        data: {
          count: 1,
          windowStart: now,
          blockedUntil: null,
        },
      });

      return {
        allowed: true,
        blockedUntil: null,
        remaining: Math.max(0, input.maxAttempts - 1),
      };
    }

    const nextCount = existing.count + 1;
    const shouldBlock = nextCount >= input.maxAttempts;
    const blockedUntil = shouldBlock
      ? new Date(now.getTime() + input.blockMs)
      : null;

    await tx.rateLimitBucket.update({
      where: { id: existing.id },
      data: {
        count: nextCount,
        blockedUntil,
      },
    });

    return {
      allowed: !shouldBlock,
      blockedUntil,
      remaining: shouldBlock ? 0 : Math.max(0, input.maxAttempts - nextCount),
    };
  });
}

export async function getRateLimitBlock(key: string): Promise<Date | null> {
  const bucket = await prisma.rateLimitBucket.findUnique({
    where: { bucketKey: key },
    select: { blockedUntil: true },
  });

  if (!bucket?.blockedUntil) return null;
  if (bucket.blockedUntil <= new Date()) return null;
  return bucket.blockedUntil;
}
