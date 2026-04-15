import type { PrismaClient, AuditEvent, Prisma } from "@prisma/client";

type WriteAuditInput = {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAudit(
  prisma: PrismaClient,
  event: AuditEvent,
  input: WriteAuditInput = {}
) {
  await prisma.auditLog.create({
    data: {
      event,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata,
    },
  });
}
