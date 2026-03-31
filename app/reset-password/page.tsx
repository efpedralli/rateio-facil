import Link from "next/link";

type ResetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const error = typeof params.error === "string" ? params.error : null;

  if (!token) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-2xl font-semibold">Reset password</h1>
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Missing token.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Reset password</h1>
      {error ? (
        <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <form action="/api/auth/reset-password" method="POST" className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={10}
            required
            autoComplete="new-password"
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            minLength={10}
            required
            autoComplete="new-password"
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <button type="submit" className="w-full rounded bg-black px-4 py-2 text-white">
          Update password
        </button>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/login" className="underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
