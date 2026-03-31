import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

async function getArgon2() {
  try {
    return await import("argon2");
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await getArgon2();
  if (argon2) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 19456,
      parallelism: 1,
    });
  }

  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  if (passwordHash.startsWith("$argon2")) {
    const argon2 = await getArgon2();
    if (!argon2) return false;
    return argon2.verify(passwordHash, password);
  }

  return bcrypt.compare(password, passwordHash);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters long.";
  return null;
}
