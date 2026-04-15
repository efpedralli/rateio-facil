import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import type { PrismaClient } from "@prisma/client";
import { AuditEvent, UserRole } from "@prisma/client";
import { getClientIp, getUserAgent } from "@/lib/request";
import { writeAudit } from "@/lib/audit";
import { getRateLimitBlock, hitRateLimit } from "@/lib/security/rateLimit";
import { verifyPassword } from "@/lib/security/password";

const LOCK_MINUTES = 15;
const LOCKOUT_AFTER_FAILED_ATTEMPTS = 5;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const isProd = process.env.NODE_ENV === "production";
export const SESSION_COOKIE_NAME = isProd
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

type CredentialsAuthInput = {
  email: string;
  password: string;
  headers: Headers | Record<string, string | string[] | undefined>;
};

type CredentialsAuthResult = {
  id: string;
  email: string;
  role: UserRole;
};

export async function authenticateCredentials(
  prisma: PrismaClient,
  input: CredentialsAuthInput
): Promise<CredentialsAuthResult | null> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const ip = getClientIp(input.headers);
  const userAgent = getUserAgent(input.headers);
  const now = new Date();
  const ipKey = `login:ip:${ip ?? "unknown"}`;
  const emailKey = email ? `login:email:${email}` : null;

  async function registerFailedAttempt() {
    await Promise.all([
      hitRateLimit({
        key: ipKey,
        windowMs: LOCK_MINUTES * 60 * 1000,
        maxAttempts: LOCKOUT_AFTER_FAILED_ATTEMPTS,
        blockMs: LOCK_MINUTES * 60 * 1000,
      }),
      emailKey
        ? hitRateLimit({
            key: emailKey,
            windowMs: LOCK_MINUTES * 60 * 1000,
            maxAttempts: LOCKOUT_AFTER_FAILED_ATTEMPTS,
            blockMs: LOCK_MINUTES * 60 * 1000,
          })
        : Promise.resolve(null),
    ]);
  }

  const [ipBlockedUntil, emailBlockedUntil] = await Promise.all([
    getRateLimitBlock(ipKey),
    emailKey ? getRateLimitBlock(emailKey) : Promise.resolve(null),
  ]);

  if (ipBlockedUntil || emailBlockedUntil) {
    await writeAudit(prisma, AuditEvent.LOGIN_FAIL, {
      ip,
      userAgent,
      metadata: { reason: "rate_limited", email },
    });
    return null;
  }

  if (!email || !password) {
    await registerFailedAttempt();
    await writeAudit(prisma, AuditEvent.LOGIN_FAIL, {
      ip,
      userAgent,
      metadata: { reason: "missing_credentials", email },
    });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    await registerFailedAttempt();
    await writeAudit(prisma, AuditEvent.LOGIN_FAIL, {
      ip,
      userAgent,
      metadata: { reason: "invalid_credentials", email },
    });
    return null;
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await writeAudit(prisma, AuditEvent.LOGIN_FAIL, {
      userId: user.id,
      ip,
      userAgent,
      metadata: { reason: "locked", lockedUntil: user.lockedUntil.toISOString() },
    });
    return null;
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    await registerFailedAttempt();
    const nextFailed = user.failedLoginCount + 1;
    const lockedUntil =
      nextFailed >= LOCKOUT_AFTER_FAILED_ATTEMPTS
        ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000)
        : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lockedUntil ? 0 : nextFailed,
        lockedUntil,
      },
    });

    await writeAudit(prisma, AuditEvent.LOGIN_FAIL, {
      userId: user.id,
      ip,
      userAgent,
      metadata: { reason: "invalid_credentials", email },
    });
    return null;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    }),
    prisma.session.deleteMany({
      where: { userId: user.id },
    }),
  ]);

  await writeAudit(prisma, AuditEvent.LOGIN_SUCCESS, {
    userId: user.id,
    ip,
    userAgent,
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}

export function createAuthOptions(prisma: PrismaClient): NextAuthOptions {
  return {
    adapter: PrismaAdapter(prisma),
    session: {
      strategy: "database",
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: 60 * 60 * 24,
    },
    secret: process.env.NEXTAUTH_SECRET,
    pages: {
      signIn: "/login",
    },
    cookies: {
      sessionToken: {
        name: SESSION_COOKIE_NAME,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: isProd,
        },
      },
    },
    providers: [
      CredentialsProvider({
        name: "Email and Password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials, req) {
          return authenticateCredentials(prisma, {
            email: String(credentials?.email ?? ""),
            password: String(credentials?.password ?? ""),
            headers: req.headers ?? {},
          });
        },
      }),
    ],
    callbacks: {
      async session({ session, user }) {
        if (session.user) {
          session.user.id = user.id;
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { role: true },
          });
          session.user.role = dbUser?.role ?? UserRole.OPERATOR;
        }
        return session;
      },
    },
    events: {
      async signOut(message) {
        const session = "session" in message ? message.session : undefined;
        if (!session) return;
        await writeAudit(prisma, AuditEvent.LOGOUT, {
          metadata: { email: session.user?.email ?? null },
        });
      },
    },
  };
}

export async function getAuthSession(prisma: PrismaClient) {
  return getServerSession(createAuthOptions(prisma));
}

export class AuthGuardError extends Error {
  public readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AuthGuardError";
    this.status = status;
  }
}

export type AuthedSession = Session & {
  user: NonNullable<Session["user"]> & { id: string };
};

export async function requireAuth(prisma: PrismaClient): Promise<AuthedSession> {
  const session = await getAuthSession(prisma);
  if (!session?.user?.id) {
    throw new AuthGuardError("Unauthorized", 401);
  }
  return session as AuthedSession;
}

export async function requireRole(prisma: PrismaClient, roles: UserRole[]) {
  const session = await requireAuth(prisma);
  if (!session.user.role || !roles.includes(session.user.role)) {
    throw new AuthGuardError("Forbidden", 403);
  }
  return session;
}
