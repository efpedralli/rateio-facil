import { prisma } from "@/lib/prisma";

type SetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const secret = typeof params.secret === "string" ? params.secret : "";
  const error = typeof params.error === "string" ? params.error : null;
  const userCount = await prisma.user.count();

  const isAllowed =
    userCount === 0 &&
    Boolean(process.env.SETUP_SECRET) &&
    secret === process.env.SETUP_SECRET;

  if (!isAllowed) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-2xl font-semibold">Initial setup</h1>
        <p className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Setup is unavailable. This endpoint works only before the first user exists and with
          the correct setup secret.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-2xl font-semibold">Create first admin</h1>
      {error ? (
        <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <form action="/api/setup" method="POST" className="space-y-4">
        <input type="hidden" name="secret" value={secret} />
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">
            Admin email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            className="w-full rounded border px-3 py-2"
          />
        </div>
        <button type="submit" className="w-full rounded bg-black px-4 py-2 text-white">
          Create admin
        </button>
      </form>
    </main>
  );
}
