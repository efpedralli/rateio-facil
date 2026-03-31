import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@/lib/prisma";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  let session: Awaited<ReturnType<typeof requireRole>> | null = null;
  try {
    session = await requireRole([UserRole.ADMIN, UserRole.OPERATOR]);
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
