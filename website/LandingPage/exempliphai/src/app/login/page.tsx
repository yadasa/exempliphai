import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="container py-24">
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This is a placeholder route for the landing page nav.
        </p>
        <div className="mt-6">
          <Link className="text-sm text-primary underline" href="/">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
