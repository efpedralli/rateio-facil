import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Rateio Fácil</h1>
      <p className="mt-2">Authentication and authorization are now configured.</p>
      <div className="mt-4 flex gap-3">
        <Link className="rounded border px-4 py-2" href="/login">
          Login
        </Link>
        <Link className="rounded border px-4 py-2" href="/dashboard">
          Dashboard
        </Link>
      </div>
    </main>
  );
}
