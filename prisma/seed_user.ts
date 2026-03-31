import "dotenv/config";
import { UserRole, prisma } from "@/lib/prisma";
import { hashPassword, validatePasswordStrength } from "@/lib/security/password";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

async function main() {
  const email = requireEnv("ADMIN_EMAIL").toLowerCase();
  const password = requireEnv("ADMIN_PASSWORD");

  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    throw new Error(passwordError);
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      email,
      passwordHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  console.log(`Admin user ready: ${user.email} (${user.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
