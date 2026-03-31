import { AuditEvent, Prisma, prisma } from "@/lib/prisma";

type WriteAuditInput = {
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAudit(event: AuditEvent, input: WriteAuditInput = {}) {
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
