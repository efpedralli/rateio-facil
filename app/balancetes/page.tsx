import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import BalanceteClient from "./BalanceteClient";

export default async function BalancetesPage() {
  let session: Awaited<ReturnType<typeof requireRole>> | null = null;
  try {
    const { prisma } = await getTenantContext();
    session = await requireRole(prisma, [UserRole.ADMIN, UserRole.OPERATOR]);
  } catch {
    redirect("/login");
  }

  if (!session) {
    redirect("/login");
  }

  return (
    <BalanceteClient
      userRole={session.user.role ?? UserRole.OPERATOR}
      userEmail={session.user.email ?? ""}
    />
  );
}
