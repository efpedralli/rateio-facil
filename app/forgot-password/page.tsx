import Link from "next/link";

type ForgotPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const params = await searchParams;
  const ok = params.ok === "1";
  const devLink = typeof params.devLink === "string" ? params.devLink : null;

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Forgot password</h1>
      {ok ? (
        <p className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          If the account exists, we sent reset instructions.
        </p>
      ) : null}
      {devLink ? (
        <p className="mb-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Development only reset link:{" "}
          <a className="underline" href={devLink}>
            {devLink}
          </a>
          <br />
          TODO: replace this with an email provider in production.
        </p>
      ) : null}
      <form action="/api/auth/forgot-password" method="POST" className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <button type="submit" className="w-full rounded bg-black px-4 py-2 text-white">
          Send reset link
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
