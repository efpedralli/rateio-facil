import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@/lib/prisma";
import BalanceteClient from "./BalanceteClient";

export default async function BalancetesPage() {
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
    <BalanceteClient userRole={session.user.role} userEmail={session.user.email ?? ""} />
  );
}
