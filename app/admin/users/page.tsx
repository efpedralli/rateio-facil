import crypto from "crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { AuditEvent, UserRole } from "@prisma/client";
import { getTenantContext } from "@/lib/multitenant";
import { getClientIp, getUserAgent } from "@/lib/request";
import { writeAudit } from "@/lib/audit";

type AdminUsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

async function createInviteAction() {
  "use server";

  const { prisma } = await getTenantContext();
  const session = await requireRole(prisma, [UserRole.ADMIN]);
  const hdrs = await headers();
  const rawToken = crypto.randomBytes(INVITE_TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const invite = await prisma.inviteToken.create({
    data: {
      tokenHash,
      role: UserRole.OPERATOR,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdByUserId: session.user.id,
    },
  });

  await writeAudit(AuditEvent.INVITE_CREATED, {
    userId: session.user.id,
    ip: getClientIp(hdrs),
    userAgent: getUserAgent(hdrs),
    metadata: { inviteId: invite.id, role: UserRole.OPERATOR },
  });

  redirect(`/admin/users?inviteToken=${encodeURIComponent(rawToken)}`);
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const params = await searchParams;
  const { prisma } = await getTenantContext();
  try {
    await requireRole(prisma, [UserRole.ADMIN]);
  } catch {
    redirect("/login");
  }

  const inviteToken = typeof params.inviteToken === "string" ? params.inviteToken : null;
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const inviteUrl = inviteToken
    ? `${process.env.NEXTAUTH_URL ?? ""}/invite?token=${encodeURIComponent(inviteToken)}`
    : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin - Users</h1>
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="rounded border px-3 py-2 text-sm">
            Logout
          </button>
        </form>
      </div>

      <section className="mb-6 rounded border p-4">
        <h2 className="mb-3 text-lg font-medium">Invite operator</h2>
        <form action={createInviteAction}>
          <button type="submit" className="rounded bg-black px-4 py-2 text-white">
            Create invite
          </button>
        </form>
        {inviteUrl ? (
          <p className="mt-3 break-all rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
            One-time invite link (expires in 24h): {inviteUrl}
          </p>
        ) : null}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 text-lg font-medium">Users</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left">Email</th>
                <th className="px-2 py-2 text-left">Role</th>
                <th className="px-2 py-2 text-left">Active</th>
                <th className="px-2 py-2 text-left">Last login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b">
                  <td className="px-2 py-2">{user.email}</td>
                  <td className="px-2 py-2">{user.role}</td>
                  <td className="px-2 py-2">{user.isActive ? "Yes" : "No"}</td>
                  <td className="px-2 py-2">
                    {user.lastLoginAt ? user.lastLoginAt.toISOString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
