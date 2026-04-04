import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
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
    <DashboardClient
      userRole={session.user.role}
      userEmail={session.user.email ?? ""}
    />
  );
}
